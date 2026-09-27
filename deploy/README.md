# Hosting a copy on AWS Lightsail

A private, password-protected copy of the app for use from an iPad (or any browser): Lightsail in Mumbai, 1 GB plan, $7/month. Caddy handles HTTPS; the app runs as a systemd service; personal data lives in `/var/lib/mct` on the server, never in the checkout.

The local Mac app is unaffected: login is off unless `MCT_PASSWORD` is set, and data stays in `data/` unless `MCT_DATA_DIR` is set.

## 1. Create the server (from the Mac)

```bash
R="--region ap-south-1"
aws lightsail create-instances $R --instance-names mct --availability-zone ap-south-1a \
  --blueprint-id ubuntu_24_04 --bundle-id micro_3_1
aws lightsail allocate-static-ip $R --static-ip-name mct-ip
aws lightsail attach-static-ip $R --static-ip-name mct-ip --instance-name mct
aws lightsail open-instance-public-ports $R --instance-name mct --port-info fromPort=443,toPort=443,protocol=TCP
# Daily snapshots at 02:00 IST (20:30 UTC); Lightsail keeps the last seven.
aws lightsail enable-add-on $R --resource-name mct \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=20:30}'
aws lightsail get-static-ip $R --static-ip-name mct-ip --query staticIp.ipAddress --output text

# SSH key for the region's default key pair
aws lightsail download-default-key-pair $R --query privateKeyBase64 --output text > ~/.ssh/lightsail-mumbai.pem
chmod 600 ~/.ssh/lightsail-mumbai.pem
```

## 2. Point the domain at it
Add an **A record** for the domain (for example `tracker.example.com`) with the static IP. Caddy can only get the HTTPS certificate once this resolves.

## 3. First push and setup

```bash
deploy/push.sh ubuntu@<static-ip>          # builds the frontend, copies the app to /opt/mct
ssh -i ~/.ssh/lightsail-mumbai.pem ubuntu@<static-ip>
sudo nano /opt/mct/.env
```

`.env` on the server:

```
ANTHROPIC_API_KEY=sk-ant-...     # a key from her own Claude Console workspace, which has a monthly spend limit
MCT_PASSWORD=...                 # long; changing it later logs every device out
```

Then, still on the server:

```bash
sudo /opt/mct/deploy/setup.sh tracker.example.com
```

## 4. On the iPad
Open `https://tracker.example.com` in Safari, log in (Safari offers to save the password), then **Share → Add to Home Screen**. It opens full screen like an app, and stays logged in for 30 days.

## Updating
`deploy/push.sh ubuntu@<static-ip>` builds, copies, installs any new requirements and restarts. Data and `.env` on the server are never touched.

## Useful on the server
- Logs: `journalctl -u mct -f` (app), `journalctl -u caddy -f` (HTTPS)
- Restart: `sudo systemctl restart mct`
- Restore: create a new instance from a snapshot in the Lightsail console, then move the static IP to it.

## Notes
- Ten wrong passwords lock the login for 15 minutes.
- The local AI-text detector (torch) is not installed on the server; the deterministic check still runs.
- Cost: $7/month for the instance, a few cents for snapshots, plus API usage (capped by the workspace spend limit).
