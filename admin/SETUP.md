# Admin — setup

The admin at `/admin` edits project cards and replaces resume PDFs by committing
to this repository. It does nothing until the four environment variables below
exist on the Vercel project.

## 1 · Create a GitHub OAuth app

<https://github.com/settings/developers> → **New OAuth App**

| Field | Value |
|---|---|
| Application name | Portfolio admin |
| Homepage URL | `https://vivaan-jain-portfolio.vercel.app` |
| Authorization callback URL | `https://vivaan-jain-portfolio.vercel.app/api/auth/callback` |

Generate a client secret and keep the page open for the next step.

> The callback URL must match exactly, including the scheme and no trailing
> slash. A mismatch is the single most common reason sign-in fails.

## 2 · Set the environment variables on Vercel

Vercel → the project → **Settings** → **Environment Variables**. Add all four to
**Production** (and Preview, if you want the admin on preview deployments).

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the OAuth app |
| `GITHUB_CLIENT_SECRET` | from the OAuth app |
| `SESSION_SECRET` | a long random string, see below |
| `GITHUB_OWNER` | `vj0246` |

`GITHUB_REPO` defaults to `Portfolio` and `GITHUB_BRANCH` to `main`; set them
only if either changes.

Generate the session secret locally and paste it in. Do not reuse it anywhere:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Redeploy after adding the variables. Vercel only injects them at build time, so
an existing deployment will not pick them up.

## 3 · Sign in

<https://vivaan-jain-portfolio.vercel.app/admin/>

GitHub will ask you to authorise the app once. Any account other than
`GITHUB_OWNER` is refused after the token exchange.

## How a save reaches the site

```
admin  ──►  /api/cards  ──►  content/projects/*.json committed to main
                                        │
                                        ▼
                          Action "Rebuild cards" runs build.py,
                          validates, commits index.html
                                        │
                                        ▼
                              Vercel redeploys  ·  live in ~90s
```

The admin never writes `index.html`. That keeps `content/projects/` as the one
source of truth whether an edit came from the admin or from a laptop, and it
means a card that would break the build is caught by `validate.py` in CI rather
than shipped.

## Security notes

- **Sign-in is GitHub OAuth, restricted to one account.** There is no password
  to guess or leak. Revoke access any time at
  <https://github.com/settings/applications>.
- **No long-lived token is stored on the server.** Writes use the token of
  whoever signed in, held only in their session cookie. Nothing can write to the
  repository unless a real person has signed in within the last 8 hours.
- **The session cookie is encrypted** with AES-256-GCM under `SESSION_SECRET`,
  and is `HttpOnly`, `Secure`, `SameSite=Lax`. Script cannot read it, and a
  leaked cookie is not a usable credential without the server key.
- **CSRF on the OAuth flow** is handled with a random `state` value in a
  short-lived cookie, compared in constant time on return.
- **Scope is `public_repo`**, the narrowest scope that can commit to a public
  repository. It cannot touch your private repositories.
- **Every write is validated server-side** against the same rules as
  `scripts/build.py`, so the API refuses a card that would fail the build.
- **Resume uploads are constrained** to three fixed paths, must begin with
  `%PDF-`, and are capped at 6MB.
- `/admin` and `/api` are `no-store` and `noindex`, and are disallowed in
  `robots.txt`.

Rotating `SESSION_SECRET` invalidates every existing session immediately, which
is the fastest way to sign everything out.
