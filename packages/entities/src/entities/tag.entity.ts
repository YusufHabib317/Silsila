import { Column, Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'tags' })
export class Tag {
  @PrimaryColumn({ type: 'uuid' })
  id!: string

  @Column({ type: 'varchar', length: 64 })
  name!: string

  @Column({ type: 'varchar', length: 32 })
  kind!: string

  @Column({ type: 'varchar', length: 16, nullable: true })
  color!: string | null
}

