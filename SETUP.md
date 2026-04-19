# Setup Guide

Get AI Agent Company running in 5 steps.

## 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and sign up (free tier works).
Click "New project", pick a name and region, set a database password.
Wait ~2 minutes for the project to finish provisioning.

## 2. Run the database migration

In your Supabase dashboard, go to **SQL Editor** (left sidebar).
Click **New query**, paste the entire contents of `supabase/migrations/001_core.sql`,
and click **Run**. You should see "Success. No rows returned." three times.

## 3. Copy the environment file

```bash
cp .env.example .env
```

Open `.env` and fill in the values. You'll need:

- **SUPABASE_URL** — Dashboard → Settings → API → Project URL
- **SUPABASE_ANON_KEY** — Dashboard → Settings → API → `anon` `public` key
- **DATABASE_URL** — Dashboard → Settings → Database → Connection string → URI (Transaction mode)
- **Telegram bot tokens** — Create 10 bots with [@BotFather](https://t.me/BotFather) on Telegram

## 4. Start the container

```bash
docker compose up -d
```

First build takes ~3 minutes (downloads Chromium, Node packages).
Check logs with `docker compose logs -f`.

If you're using a Claude subscription instead of an API key,
SSH into the container and log in:

```bash
ssh root@localhost -p 2222    # password: aicompany
claude
# type /login, follow the OAuth link
```

## 5. Open the dashboard

Go to [http://localhost:9800](http://localhost:9800).
You should see the Pixel Office with 10 agent desks.

Send a message in your Telegram group to test. The orchestrator bot
will pick it up and start dispatching work to the other agents.
