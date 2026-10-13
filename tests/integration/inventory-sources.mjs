// Explicit reviewed migrations only. Never discover environment links or .env files.
export const inventoryMigrations = [
  '001_initial_schema.sql',
  '002_rls_policies.sql',
  '003_operations_and_seed.sql',
  '004_balances_travel_media.sql',
  '005_private_inventory_media.sql',
  '20261012232840_inventory_setup_location_labels.sql',
];
