/// <reference path="../pb_data/types.d.ts" />

// Poker Together online transport: the replicated action log + presence.
//
// PocketBase is the SEQUENCER — writes serialize through it, and clients read the
// log back in `seq` order (NOT SSE arrival order, which PB does not guarantee).
// SSE is only a "something changed, go read" nudge; on connect/reconnect a client
// queries `seq > lastSeen` to catch up. See docs/poker-backend.md.
//
// Rules are open on purpose: this is a play-money game, invite codes are the only
// gate, and the deterministic replay + chip-conservation check catch bad entries.
// gotcha baked in: `seq` is NOT `required` — PocketBase treats a required number
// value of 0 as "empty", which would silently reject the first (deal, seq 0) entry.

migrate(
  (app) => {
    const actions = new Collection({
      type: 'base',
      name: 'pk_actions',
      listRule: '',
      viewRule: '',
      createRule: '',
      fields: [
        { name: 'room', type: 'text', required: true, max: 32 },
        { name: 'seq', type: 'number', required: false },
        { name: 'body', type: 'json', required: true, maxSize: 20000 },
      ],
      indexes: ['CREATE INDEX `idx_pk_actions_room_seq` ON `pk_actions` (`room`, `seq`)'],
    })
    app.save(actions)

    const presence = new Collection({
      type: 'base',
      name: 'pk_presence',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'room', type: 'text', required: true, max: 32 },
        { name: 'peer', type: 'text', required: true, max: 64 },
        { name: 'name', type: 'text', required: false, max: 40 },
        { name: 'seat', type: 'number', required: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_pk_presence_room_peer` ON `pk_presence` (`room`, `peer`)',
      ],
    })
    app.save(presence)
  },
  (app) => {
    for (const name of ['pk_actions', 'pk_presence']) {
      try {
        app.delete(app.findCollectionByNameOrId(name))
      } catch (_) {
        // already gone
      }
    }
  },
)
