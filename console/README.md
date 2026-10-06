# Vendor console

React app for Milestone 2. It runs on your laptop and calls the deployed usage API.

```powershell
# from the repo root, after console/.env.local exists
npm run dev:console
```

Copy `console/.env.example` to `console/.env.local` and set `API_KEY`. The file is gitignored.

The browser calls `/api/*` on the Vite server, which proxies to API Gateway and adds the `x-api-key` header, so the key never ships to the browser.

## Sharing a demo over a tunnel

```powershell
npm run dev:console
# in another terminal
cloudflared tunnel --url http://localhost:5173
```

Anyone with the tunnel URL can read and write usage through your key (still capped by the API usage plan), so stop the tunnel after the demo.
