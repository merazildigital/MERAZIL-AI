# Merazil AI Ultra — Owner Backend + Web App

Theme/front-end ka dark Merazil design same rakha gaya hai. Backend ko pro level pe upgrade kiya gaya hai:

- Real AI API support: OpenAI or Anthropic/Claude
- Real search engine API support: Serper, Tavily, Brave Search
- Same web app for public users
- Admin route: `/admin`
- Admin stats API protected by `ADMIN_PASSWORD`
- Rate limiting, Helmet security headers, CORS, compression
- Usage log in `data/usage-log.json`
- Chat log metadata in `data/chat-log.jsonl`

## Setup

```bash
npm install
cp .env.example .env
# .env mein API keys aur ADMIN_PASSWORD set karo
npm start
```

Open:

- Public app: `http://localhost:5050/`
- Owner admin: `http://localhost:5050/admin`
- Health check: `http://localhost:5050/api/health`

## Recommended .env

Use OpenAI:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4.1-mini
```

Use Claude:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_MODEL=claude-3-5-haiku-latest
```

Search engine:

```env
SEARCH_PROVIDER=auto
SERPER_API_KEY=your-serper-key
# or TAVILY_API_KEY / BRAVE_SEARCH_API_KEY
```

## Deploy

Render/Railway/Fly.io/VPS par deploy karo. Environment variables panel mein `.env` wali values set karna. API keys kabhi frontend HTML mein mat daalna.

## Owner Control

Admin panel ka front-end password app ke localStorage mein hai, lekin real backend admin data `/api/admin-info` par `ADMIN_PASSWORD` header se protected hai. Deploy ke baad `ADMIN_PASSWORD` strong rakhna.
