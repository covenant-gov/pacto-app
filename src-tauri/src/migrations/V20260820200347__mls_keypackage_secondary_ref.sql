-- Dual kind:30443/kind:443 KeyPackage publishing republishes the same device KeyPackage
-- under both event kinds, minted as two distinct event ids from identical content.
-- keypackage_ref_secondary holds the second id alongside the existing `keypackage_ref`, so
-- self-device cache verification can confirm both are still resolvable instead of trusting
-- one kind's survival for both. NULL for contact-resolved rows, which only ever track a
-- single fetched event.
--
-- keypackage_d_tag holds the addressable (kind:30443) `d` tag value for a self-device row.
-- Reusing the same value across rotations is what makes kind:30443 actually replace the
-- previous event on relays (NIP-33); without it every rotation would mint a new, permanently
-- live address. NULL for contact-resolved rows.
ALTER TABLE mls_keypackages ADD COLUMN keypackage_ref_secondary TEXT;
ALTER TABLE mls_keypackages ADD COLUMN keypackage_d_tag TEXT;
