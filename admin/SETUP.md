# Site editor

**<https://vivaan-jain-portfolio.vercel.app/admin/>**

A page for changing the portfolio without touching code. Projects, experience and
the resume are all edited through ordinary forms, and every save goes to GitHub
and onto the live site by itself.

---

## For the person editing

No engineering needed. You need a GitHub account that the site owner has approved.

1. Open the link above and choose **Continue with GitHub**.
2. Pick a tab: **Projects**, **Experience** or **Resume**.
3. Click an entry on the left to edit it, or **+ Add** to create one.
4. Change what you need. The preview shows how a project will look when closed.
5. Press **Save and publish**. The live site shows the change in about 90 seconds.

Things worth knowing:

- **Nothing is lost by accident.** Every save is recorded on GitHub with your
  name, and any earlier version can be restored from there.
- **If a save is refused**, the message says which field to fix. A change that
  would break the page is stopped before it is published, and the site stays on
  its previous version.
- **Order** decides position: lower numbers appear first. The hint under the
  field lists the numbers already in use.
- **Diagram** sections are edited as text in a structured format. Leave them alone
  unless you are sure; everything else is plain fields.
- **Resume** accepts a PDF up to 3MB. Pick which of the three resumes to replace.
- If the page says you have been signed out, copy anything you typed, reload,
  and sign in again. Sessions last 8 hours.

---

## One-time setup (the site owner, about 5 minutes)

The editor does nothing until these exist. Until then, signing in shows
*missing required environment variable: GITHUB_CLIENT_ID*.

### 1. Create a GitHub OAuth app

<https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**

| Field | Value |
|---|---|
| Application name | Portfolio editor |
| Homepage URL | `https://vivaan-jain-portfolio.vercel.app` |
| Authorization callback URL | `https://vivaan-jain-portfolio.vercel.app/api/auth/callback` |

Then **Generate a new client secret**, and keep the page open.

> The callback URL must match exactly, with no trailing slash. A mismatch is the
> most common reason sign-in fails.

### 2. Add the environment variables on Vercel

Vercel → the project → **Settings** → **Environment Variables**, for **Production**:

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | from the OAuth app |
| `GITHUB_CLIENT_SECRET` | from the OAuth app |
| `SESSION_SECRET` | a long random string, generated below |
| `GITHUB_OWNER` | `vj0246` |

Generate the session secret on your own machine and paste it in:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 3. Redeploy

Vercel → **Deployments** → the latest one → **⋯** → **Redeploy**. Environment
variables only reach a deployment built after they were added.

Then open the editor link and sign in.

---

## Letting someone else edit

Off by default: only `GITHUB_OWNER` can sign in. To add a person:

1. **Invite them to the repository** as a collaborator:
   <https://github.com/vj0246/Portfolio/settings/access>. Saves are made with their
   own GitHub account, so without write access every save is refused.
2. **Add their GitHub username** to a new variable on Vercel, comma separated, and
   include your own:

   | Name | Value |
   |---|---|
   | `GITHUB_ALLOWED_LOGINS` | `vj0246,theirusername` |

3. Redeploy.

To remove someone, take them out of `GITHUB_ALLOWED_LOGINS` and redeploy. The
list is checked on every request, so an open session stops working immediately.
Removing them as a collaborator on GitHub does the same.

---

## How a save reaches the site

```
editor ──► /api/cards or /api/experience ──► content/*.json committed to main
                                                        │
                                                        ▼
                                  "Rebuild cards" Action: build.py, validate.py,
                                  commits index.html
                                                        │
                                                        ▼
                                             Vercel redeploys · ~90s
```

The editor never writes `index.html`. `content/` stays the single source of truth
whether a change came from the editor or from a laptop, and a change that would
break the page fails `validate.py` in CI instead of shipping.

Resumes skip the rebuild: `/api/resume` commits the PDF directly and Vercel
redeploys it.

---

## Security

- **GitHub sign-in, restricted to an allow-list.** No password exists to guess or
  leak. Revoke the app any time at <https://github.com/settings/applications>.
- **No long-lived token on the server.** Saves use the signed-in person's own
  token, held only in their session cookie, with `public_repo` scope.
- **Encrypted session cookie**: AES-256-GCM under `SESSION_SECRET`, `HttpOnly`,
  `Secure`, `SameSite=Lax`, 8-hour expiry. Rotating the secret signs everyone out.
- **CSRF on sign-in** is handled with a random `state`, compared in constant time.
- **Every save is validated on the server** with the same rules as
  `scripts/build.py`, and refused if it would break the page.
- **Concurrent edits are detected.** If an entry changed since it was opened, the
  save is refused rather than overwriting the other change.
- **Resume uploads** go to three fixed paths only, must start with `%PDF-`, and are
  capped at 3MB, because Vercel rejects request bodies over 4.5MB and base64
  adds a third.
- `/admin` and `/api` are `no-store`, `noindex`, and disallowed in `robots.txt`.
