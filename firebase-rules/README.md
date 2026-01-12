# Firebase Security Rules

This folder contains the Firebase Realtime Database security rules for both databases.

## Files

| File | Database | Project |
|------|----------|---------|
| `booking-db-rules.json` | Booking DB | gaming-cafe-booking |
| `fdb-dataset-rules.json` | FDB Dataset | fdb-dataset |

## How to Apply

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Realtime Database** → **Rules**
4. Copy the contents of the appropriate JSON file
5. Paste into the rules editor
6. Click **Publish**

## Rule Explanations

### Booking DB (`booking-db-rules.json`)
- All paths require authentication (`auth != null`)
- Staff can read/write all data when logged in
- No public access allowed

### FDB Dataset (`fdb-dataset-rules.json`)
- Read requires authentication
- Write is set to `false` (only Admin SDK / service account can write)
- Python sync scripts use service account credentials, which bypass rules

## Important Notes

⚠️ **Service Account Access**: The Python sync scripts use Firebase Admin SDK with service account credentials. This gives them **full database access regardless of security rules**.

⚠️ **Cross-Project Auth**: If you need web app (authenticated via `gaming-cafe-booking`) to read from `fdb-dataset`, you may need to configure cross-project authentication or use the same Firebase project for both.

