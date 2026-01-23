# Device Name Feature - Extension Changes

## Overview

The PromptLineAI extension has been updated to include a `device_name` field in all `/ingest` payloads. This allows dashboards to display human-readable device names (e.g., "Pauls-MacBook-Pro.local", "DESKTOP-7F3A2Q") instead of only opaque UUIDs.

## Changes to Payload Structure

### Updated Root Object

The `/ingest` payload now includes a new required field `device_name` at the root level:

**Before:**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "events": [...]
}
```

**After:**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "unassigned",
  "events": [...]
}
```

### Field Specification

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_id` | string (UUID) | Yes | Unique device identifier (unchanged) |
| `device_name` | string | Yes | Human-readable device name. Defaults to `"unassigned"` if not configured by user. |
| `events` | array | Yes | Array of event objects (unchanged) |

## Device Name Behavior

### Default Value

- **Default**: `"unassigned"` (literal string)
- The extension always sends a `device_name` field - it is never `null` or omitted
- If the user has not configured a custom device name, the extension sends `"unassigned"`

### User Configuration

- Users can optionally configure a custom device name via the extension's Options page
- Device name is stored in `chrome.storage.sync` (with fallback to `chrome.storage.local`)
- If a user sets a device name, that value is sent in all subsequent payloads
- If a user clears the device name (or it's never set), the extension sends `"unassigned"`

### Examples

**Unconfigured device (default):**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "unassigned",
  "events": [...]
}
```

**Configured device name:**
```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "Pauls-MacBook-Pro.local",
  "events": [...]
}
```

**Another example:**
```json
{
  "device_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "device_name": "DESKTOP-7F3A2Q",
  "events": [...]
}
```

## Complete Payload Example

```json
{
  "device_id": "b70e507e-b843-4979-be70-eea4f175bb05",
  "device_name": "My-Development-Machine",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ts": "2026-01-16T17:00:00.000Z",
      "tool": "chatgpt",
      "event_type": "visit",
      "url_host": "chatgpt.com",
      "file_ext": null,
      "file_size_kb": null,
      "file_name": null,
      "prompt_len_bucket": null,
      "has_code_block": null,
      "paste_detected": null
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "ts": "2026-01-16T17:00:05.000Z",
      "tool": "chatgpt",
      "event_type": "prompt_submit",
      "url_host": "chatgpt.com",
      "file_ext": null,
      "file_size_kb": null,
      "file_name": null,
      "prompt_len_bucket": "200-1000",
      "has_code_block": true,
      "paste_detected": false
    }
  ]
}
```

## Backend Requirements

### Schema Changes

The backend database schema and `/ingest` endpoint should be updated to:

1. **Accept `device_name` field** in the request payload
2. **Store `device_name`** in the database (likely in a `devices` table or similar)
3. **Handle the default value** `"unassigned"` appropriately

### Validation

- `device_name` is a **required string** field in the payload
- The extension always sends this field (never `null` or omitted)
- Valid values:
  - `"unassigned"` (default, literal string)
  - Any user-configured string (e.g., "Pauls-MacBook-Pro.local", "DESKTOP-7F3A2Q")
- Consider length limits (e.g., max 255 characters) for database storage
- Consider character restrictions (e.g., alphanumeric, hyphens, dots, underscores)

### Database Considerations

**Recommended approach:**
- Add `device_name` column to the `devices` table (or equivalent)
- Store the device name alongside `device_id`
- Update existing devices: set `device_name = 'unassigned'` for devices that haven't sent the new field yet
- Consider making `device_name` nullable initially for backward compatibility, then migrate to non-nullable with default `'unassigned'`

**Example schema change:**
```sql
ALTER TABLE devices 
ADD COLUMN device_name VARCHAR(255) DEFAULT 'unassigned';

-- Update existing rows
UPDATE devices 
SET device_name = 'unassigned' 
WHERE device_name IS NULL;
```

### API Endpoint Changes

The `/ingest` endpoint should:

1. **Accept `device_name`** in the request body
2. **Validate** that `device_name` is a non-empty string
3. **Store or update** the device name when processing the payload
4. **Handle idempotency**: If a device already exists, update its `device_name` if provided (or keep existing if not provided, depending on your business logic)

### Migration Strategy

**Option 1: Backward Compatible (Recommended)**
- Make `device_name` optional in validation initially
- Default to `"unassigned"` if not provided
- Gradually migrate to required field

**Option 2: Immediate Update**
- Require `device_name` field immediately
- Reject requests without it (return 400)
- Update all existing devices to have `device_name = 'unassigned'`

## Extension Implementation Details

### Storage

- Device name is stored in `chrome.storage.sync` (with fallback to `local`)
- Storage key: `"config_device_name"`
- Value: `string | null` (null means use default "unassigned")

### Options Page

- New input field added to Options page
- Field is optional (not required)
- Placeholder text: "unassigned"
- Help text explains the purpose

### Payload Construction

- Device name is read from config storage when building the payload
- Logic: `config.deviceName || "unassigned"`
- This happens in `src/background.ts` in the `flushEvents()` function

## Testing

To test the new field:

1. **Default behavior**: Load extension without configuring device name → verify payload contains `"device_name": "unassigned"`
2. **Custom name**: Set device name in Options page → verify payload contains the custom name
3. **Clear name**: Clear device name in Options page → verify payload reverts to `"device_name": "unassigned"`

## Notes

- The extension change is **backward compatible** from the extension's perspective (always sends the field)
- The backend should handle both old payloads (without `device_name`) and new payloads (with `device_name`) during migration
- The `"unassigned"` value is a literal string, not a special sentinel - treat it as a normal device name value
- Device names are user-provided and should be treated as untrusted input (validate, sanitize, length-limit)
