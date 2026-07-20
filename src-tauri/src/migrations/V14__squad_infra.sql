-- Deployed squad infra per parent (sponsor, pacto-gov stack, standalone Safes, etc.).
CREATE TABLE squad_infra (
    id TEXT PRIMARY KEY NOT NULL,
    parent_id TEXT NOT NULL,
    infra_type TEXT NOT NULL,
    chain TEXT NOT NULL,
    canonical_ref TEXT NOT NULL,
    pacto_gov_revision TEXT,
    provider_payload TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_squad_infra_parent ON squad_infra(parent_id, created_at_ms);

-- Drop the legacy disposable single-row governance table if it exists.
DROP TABLE IF EXISTS parent_governance;

-- Deduplicate pacto_gov rows per parent, keeping the one with the latest updated_at_ms.
DELETE FROM squad_infra
WHERE id IN (
    SELECT id FROM squad_infra si
    WHERE infra_type = 'pacto_gov'
      AND id NOT IN (
          SELECT id FROM squad_infra si2
          WHERE si2.parent_id = si.parent_id
            AND si2.infra_type = 'pacto_gov'
          ORDER BY si2.updated_at_ms DESC
          LIMIT 1
      )
);

-- One pacto_gov row per parent; other infra types stay multi-row.
CREATE UNIQUE INDEX idx_squad_infra_pacto_gov_singleton ON squad_infra(parent_id, infra_type) WHERE infra_type = 'pacto_gov';
