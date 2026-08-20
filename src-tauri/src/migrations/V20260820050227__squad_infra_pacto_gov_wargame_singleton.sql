-- One war-game stack row per parent; never shares the pacto_gov singleton.
DELETE FROM squad_infra
WHERE id IN (
    SELECT id FROM squad_infra si
    WHERE infra_type = 'pacto_gov_wargame'
      AND id NOT IN (
          SELECT id FROM squad_infra si2
          WHERE si2.parent_id = si.parent_id
            AND si2.infra_type = 'pacto_gov_wargame'
          ORDER BY si2.updated_at_ms DESC
          LIMIT 1
      )
);

CREATE UNIQUE INDEX idx_squad_infra_pacto_gov_wargame_singleton
    ON squad_infra(parent_id, infra_type)
    WHERE infra_type = 'pacto_gov_wargame';
