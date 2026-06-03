import { Entity, PrimaryColumn } from 'typeorm'

@Entity({ name: 'contact_tags' })
export class ContactTag {
  @PrimaryColumn({ type: 'uuid', name: 'contact_id' })
  contactId!: string

  @PrimaryColumn({ type: 'uuid', name: 'tag_id' })
  tagId!: string
}

