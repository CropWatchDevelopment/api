# CropWatch permission model (v2, 5 levels)

## Concepts

- **Locations** (`cw_locations`) contain **devices** (`cw_devices.location_id`).
- A user gets access to a location via a row in `cw_location_owners`; the UI
  also creates a `cw_device_owners` row per device in that location (default
  **Disabled**), so device visibility is opt-in per device.
- **Owner** is *implicit*, not a level: `cw_locations.owner_id` /
  `cw_devices.user_id`. The owner is the only one who can delete the resource.
- **CropWatch staff** (JWT email ending `@cropwatch.io`) bypass scoping
  globally (`isCropwatchStaff`), and staff permission rows are hidden from
  non-staff users (server-side, `owner-filter.helper.ts`).

## Levels

| Level | Name | Read | Edit resource | Manage users / rules / reports | Delete resource |
|---|---|---|---|---|---|
| — | Owner (implicit) | ✅ | ✅ | ✅ | ✅ |
| 1 | Admin | ✅ | ✅ | ✅ | ❌ |
| 2 | Manager | ✅ | ✅ | ✅ | ❌ |
| 3 | User | ✅ | ✅ | ❌ | ❌ |
| 4 | Viewer | ✅ | ❌ | ❌ | ❌ |
| 5 | Disabled | ❌ | ❌ | ❌ | ❌ |

Thresholds (single source of truth: `api/src/v1/common/permission-levels.ts`,
mirrored in `CropWatch/src/lib/constants/permissions.ts`):

- **Read scope**: `permission_level < 5` (`canRead`)
- **Manage scope** (edit users' permissions, create/edit/delete rules &
  reports): `permission_level <= 2` (`canManage`)
- Rules and reports are **manager-level** operations on every device they
  reference.

## Moving a device between locations

`PATCH /v1/devices/:dev_eui` with a new `location_id` is a **hand-over**
(`devices.service.ts#updateDevice`):

1. The mover needs manage rights on the device (≤ Manager) **and** on the
   destination location (owner/Admin/Manager) — adding a device to a location
   is a location-manage action. Staff bypass both.
2. `cw_devices.user_id` is set to the destination location's `owner_id`
   (ownership follows the location; if the location has no owner the current
   device owner is kept).
3. Every existing `cw_device_owners` row is deleted (the old location's
   permissions do not follow the device).
4. Every member of the destination location gets a **Disabled** row (opt-in
   visibility, mirroring device creation), except:
   - the destination owner — no row, ownership is implicit;
   - the mover — gets an **Admin** row.

## Migration from the old 4-level model

| Old | | New |
|---|---|---|
| 1 Admin | → | 1 Admin (unchanged) |
| 2 Editor | → | 2 Manager (rename only) |
| — | | 3 User (new) |
| 3 Viewer | → | 4 Viewer (**data remap**) |
| 4 Disabled | → | 5 Disabled (**data remap**) |

Applied by `supabase/updates/001_permission_levels.sql` (sentinel-guarded;
remaps `4→5` before `3→4`; adds CHECK constraints `1..5`).

## Rollout order (level numbers change meaning — order is load-bearing)

1. **Additive API release**: `/v1/rules-new/triggered(+/count)`, power-endpoint
   guard, TTI webhook fail-closed (set `PRIVATE_TTI_WEBHOOK_TOKEN` first),
   server-side staff filtering. No threshold changes.
2. **Maintenance window**: run `001_permission_levels.sql`, then immediately
   deploy the API release using the new thresholds.
   - Old API + new data = fail **closed** (remapped Viewers briefly lose read) — acceptable.
   - New API + old data = fail **open** (old Disabled users gain access) — never this order.
3. Deploy CropWatch (5-level dropdowns, `Disabled = 5` fallbacks, route
   takeover, device-refresh scheduler).
4. Deploy the API release removing old `/v1/rules`, `/v1/reports`, realtime.
5. Run `updates/002`–`007`; `008` last (manual, destructive, backup first).

## Manual test script (after step 3)

1. `000_preflight_report.sql` before/after `001`: catalog reads
   1 Admin / 2 Manager / 3 User / 4 Viewer / 5 Disabled; no rows outside 1–5.
2. As a **Viewer (4)** user: device data visible, edits rejected (403),
   rules/reports read-only.
3. As a **Disabled (5)** user: the device does not appear anywhere.
4. As a **Manager (2)**: can edit devices, manage users, create/edit/delete
   rules and reports.
5. As a **User (3)**: can edit device settings, cannot manage permissions or
   create rules/reports.
6. As a non-staff user, the location/device user lists contain **no
   @cropwatch.io rows**; as a staff user they do.
7. After `002`–`004`: PostgREST read with the anon key returns
   `permission denied`; login and new-account signup (profile row creation)
   still work; every app page loads.
