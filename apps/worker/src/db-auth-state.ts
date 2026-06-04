import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap,
} from 'baileys'
import { DataSource } from 'typeorm'
import { WaAuthKey } from '@wa/entities'

// A Postgres-backed replacement for Baileys' useMultiFileAuthState.
// Everything Baileys needs to stay logged in lives in the wa_auth_key table,
// so the worker is stateless on disk and a redeploy never drops the pairing.
export async function useDbAuthState(
  dataSource: DataSource,
  sessionId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const repo = dataSource.getRepository(WaAuthKey)

  const write = async (key: string, value: unknown) => {
    const serialized = JSON.stringify(value, BufferJSON.replacer)
    await repo.upsert({ sessionId, key, value: serialized }, ['sessionId', 'key'])
  }

  const read = async <T>(key: string): Promise<T | null> => {
    const row = await repo.findOne({ where: { sessionId, key } })
    return row ? (JSON.parse(row.value, BufferJSON.reviver) as T) : null
  }

  const remove = async (key: string) => {
    await repo.delete({ sessionId, key })
  }

  const creds: AuthenticationCreds = (await read('creds')) ?? initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {} as Partial<{
            [K in keyof SignalDataTypeMap]: { [id: string]: SignalDataTypeMap[K] | null }
          }>
          await Promise.all(
            ids.map(async (id) => {
              const typedType = type as keyof SignalDataTypeMap
              const existing = await read<SignalDataTypeMap[keyof SignalDataTypeMap]>(`${typedType}-${id}`)
              let value = existing as SignalDataTypeMap[typeof typedType] | null
              // app-state-sync-key must be rehydrated into its proto type.
              if (typedType === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Parameters<typeof proto.Message.AppStateSyncKeyData.fromObject>[0],
                ) as SignalDataTypeMap[typeof typedType]
              }
              const bucket = (data[typedType] ??= {}) as { [id: string]: SignalDataTypeMap[typeof typedType] | null }
              bucket[id] = value
            }),
          )

          return data as { [id: string]: SignalDataTypeMap[typeof type] }
        },
        set: async (data) => {
          const tasks: Promise<void>[] = []
          for (const type in data) {
            const typedType = type as keyof SignalDataTypeMap
            const typedData = data[typedType] as
              | { [id: string]: SignalDataTypeMap[typeof typedType] | null }
              | undefined
            if (!typedData) continue
            for (const id in typedData) {
              const value = typedData[id]
              const key = `${type}-${id}`
              tasks.push(value ? write(key, value) : remove(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: () => write('creds', creds),
  }
}
