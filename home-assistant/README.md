# Home Assistant local preview

Budget Assistant has a Python API, a compiled React UI, a SQLite database, ingress identity support, and a read-only endpoint for bill automations. The local Supervisor preview uses the installed slug `local_budget_assistant` and its own persistent data volume. Its initial installation, startup, and authenticated ingress have been verified; each update still requires fresh checks.

## Local server and bill sensors

Run the app locally or with Docker Compose before moving it into Home Assistant. Compose binds `127.0.0.1:8099` by default. For trusted LAN development, set `BUDGET_BIND_ADDRESS=0.0.0.0` in `.env` and recreate the container. Use a TLS reverse proxy before exposing standalone login beyond a trusted development network.

Create the first local user through the app. An administrator can generate or rotate a Home Assistant integration token in Settings. Rotation invalidates the previous token. This token grants access only to household bill counts and amounts at `GET /api/ha/bills`; it cannot read budgets, bank transactions, personal bills, or bill names. Keep the token in Home Assistant `secrets.yaml`.

```yaml
budget_assistant_bills_url: "http://PI_LAN_ADDRESS:8099/api/ha/bills"
budget_assistant_authorization: "Bearer YOUR_GENERATED_INTEGRATION_TOKEN"
```

Merge the `rest:` section in [rest-sensors.yaml](rest-sensors.yaml) into `configuration.yaml`, then validate and reload the REST integration or restart Home Assistant. The shared REST resource makes one request per minute for four bill counts, four USD amounts, and four binary sensors. Budgets and bill totals currently use USD; non-USD bank transactions are not imported into those totals. A network timeout makes entities unavailable; it does not mean there are zero unpaid bills. See [Home Assistant RESTful documentation](https://www.home-assistant.io/integrations/rest/).

Bill groups are disjoint. Past due is before the local calendar date; today is the local date; this week is tomorrow through Sunday; next week is Monday through Sunday. Paid bills are excluded. The household timezone determines midnight and week boundaries, including daylight-saving changes. The endpoint returns `as_of`, `timezone`, and exact boundary dates as well as each bucket's `count` and `total_cents`. On Sunday the remaining-this-week bucket is empty. To create an automation covering today and the remaining week, combine those two counts.

## Package and install the local preview

From the repository root, create a reviewed source archive:

```bash
python3 scripts/package-preview.py
```

The script creates `artifacts/budget-assistant-ha-preview.tar.gz`, `artifacts/ha-preview/`, and `artifacts/ha-preview-manifest.json`. It includes the complete Docker build context, validates relative frontend imports, and records file, source, and archive SHA256 hashes. It uses an explicit source allowlist: databases, application secrets, environment files, local dependencies, and compiled previews are excluded. The packaged name is **Budget Assistant (Preview)** and its sidebar title is **Budget Preview**; the original source metadata keeps its normal name.

Terminal & SSH 10.5.0 mounts Supervisor's local app directory at `/local_apps`; this path was verified on the preview host. Its [official changelog](https://github.com/home-assistant/addons/blob/master/ssh/CHANGELOG.md#1050) records the rename from `/addons`, and its [configuration](https://github.com/home-assistant/addons/blob/master/ssh/config.yaml) declares `local_apps:rw`. The [developer testing guide](https://developers.home-assistant.io/docs/apps/testing/) still describes `/addons`. Before extracting, verify that the destination is a mounted Supervisor local app directory: an unmounted `/addons` directory can belong only to the terminal container and will be invisible to Supervisor. Use `/addons` on older Terminal & SSH versions only after confirming that mount.

1. Transfer the archive to the intended HA host through an approved connection. Compare the target archive's SHA256 with `archive_sha256` in the manifest before extracting it.
2. Extract the source into `/local_apps/budget_assistant/`, with `config.yaml`, `Dockerfile`, `backend/`, `frontend/`, and `scripts/` together. This folder is the local add-on build context.
3. Reload Supervisor's local app/add-on catalog. Select **Budget Assistant (Preview)**, confirm slug `local_budget_assistant`, and install it. Wait for the build and installation result before starting it.
4. Choose the household timezone in the add-on Configuration tab before the first authenticated app visit. Start the preview, inspect its logs, and open **Budget Preview** through Home Assistant ingress. Enable the sidebar entry if needed.
5. Let the intended administrator's actual HA session make the first app visit. The first app user creates the household administrator; subsequent HA users get their own personal scopes. The initial budget is empty and uses real-data mode.

The metadata supports `aarch64` and `amd64`. Supervisor supplies the build architecture and version labels. Build time uses Node; the running container serves the compiled UI and Python API without a Node server. No external host port is needed for ingress. `/api/health` is suitable for a basic server check; verify user access through genuine HA ingress rather than injecting a made-up user identity.

## Update an existing preview

Before updating, create a Supervisor backup of `local_budget_assistant`. Generate a fresh archive and manifest from the reviewed source, then verify the transferred archive hash again. Stop the preview and replace only its source under the verified local app mount, `/local_apps/budget_assistant/` with Terminal & SSH 10.5.0. Reload the catalog and rebuild the local add-on, or update it when its configured version has changed. Start it and verify logs, ingress loading, and the existing household records.

Keep the Supervisor-managed data volume across rebuilds and updates. The preview's source folder and its private `/data` volume are separate. Uninstalling and reinstalling can remove persisted records; use the rebuild/update path for source changes. The `local_budget_assistant` namespace gives this preview independent data from repository-installed add-ons.

Version 0.2 adds named income entries and optional pay schedules. Its additive database migration preserves each existing monthly total as an editable **Monthly income** line, without counting it twice. Select **Replace previous monthly total** when replacing that line with a detailed breakdown. Back up the complete data volume before updating, since the application secret is required to restore encrypted bank connections. See [income and pay schedules](../README.md#income-and-pay-schedules) for calendar and month-copy behavior.

Version 0.5 adds compact transactions, debt account terms and payment schedules, account balance observations, and net-worth history. Debt schedules create managed monthly allocations and individual bill occurrences; these use the existing household unpaid buckets. Existing accounts receive an initial balance observation without reconstructing earlier history. Account removal now archives the account and retains its observations and associations. See [accounts, debts, and balance history](../README.md#accounts-debts-and-balance-history) before replacing a manual debt budget item with a generated payment schedule.

The container persists its database and application secrets in `/data`, which Supervisor manages. Its startup script reads `/data/options.json` for `timezone`, then starts Uvicorn on port 8099 with proxy-header rewriting disabled. Ingress is the default under Supervisor. The synthetic demo is a standalone preview and is not a Supervisor app option. The sidebar panel is available to all HA users; the API still enforces household and personal access separately. Supervisor backups stop this app while copying `/data` so SQLite and its journal are captured consistently. Keep the persisted application secret with the database when restoring encrypted bank connections.

For sensor testing from Home Assistant Core inside the Supervisor network, the local add-on hostname is expected to be `local-budget-assistant`, giving the resource URL `http://local-budget-assistant:8099/api/ha/bills`. Verify the actual hostname in the installed app information. The integration endpoint requires its own generated token. Configure the sample sensors after the preview's ingress and household data entry work correctly.

## Identity and privacy

Ingress supplies `X-Remote-User-Id`, `X-Remote-User-Name`, and `X-Remote-User-Display-Name`. The API trusts these only when the actual TCP peer matches `BUDGET_INGRESS_PROXY`, default `172.30.32.2`. It uses the HA user ID as the stable identity, and rejects requests with no valid identity. `X-Forwarded-For` is not an authentication source. Uvicorn must retain `--no-proxy-headers`. See [HA ingress requirements](https://developers.home-assistant.io/docs/apps/presentation/) and [HA identity headers](https://developers.home-assistant.io/docs/apps/security/).

Standalone mode uses `BUDGET_AUTH_MODE=local` and `BUDGET_LOCAL_AUTH=true`. Ingress mode disables local login unless explicitly enabled. Keep personal budget details in the application: the household view can receive an owner's opted-in totals, but the shared bill endpoint does not publish personal totals or private items. Home Assistant entities are visible to people with access to that HA installation, so only household aggregates are exported.

Deployment verification includes ingress paths and source addresses on the target HA installation, backup/restore of `/data`, token rotation, user onboarding, and the REST sensors. MQTT discovery or a dedicated integration can follow after the local bill behavior is settled.
