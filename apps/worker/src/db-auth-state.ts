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

  const read = async <T = any>(key: string): Promise<T | null> => {
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
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`)
              // app-state-sync-key must be rehydrated into its proto type.
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            }),
          )
          return data
        },
        set: async (data) => {
          const tasks: Promise<void>[] = []
          for (const type in data) {
            for (const id in (data as any)[type]) {
              const value = (data as any)[type][id]
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
