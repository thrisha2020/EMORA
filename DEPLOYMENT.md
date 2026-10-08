# 🚀 EMORA Deployment Guide

This guide explains how to deploy the **EMORA Emotion Assistant** using **Vercel** for the Frontend and **Render** / **Railway** for the Backend.

---

## 1. Backend Deployment (Render or Railway)

### Option A: Render (Free Tier Friendly)

1. Sign in to [Render.com](https://render.com/).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository `https://github.com/thrisha2020/EMORA.git`.
4. Choose **Docker** as the Runtime:
   - **Build Command:** *(Leave empty - Render detects Dockerfile)*
   - **Start Command:** *(Leave empty - defined in Dockerfile)*
   - **Environment Variables:**
     - `SECRET_KEY`: *(Generate a secure random string)*
     - `EMORA_WARMUP`: `0`
     - `EMORA_FACE_LIVENESS`: `0` *(recommended on cloud containers)*
     - `LLM_API_KEY`: *(Your OpenAI / Gemini / Groq key, or configure via UI settings)*
5. Click **Create Web Service**. Render will build the Docker container and provide your live URL (e.g. `https://emora-backend.onrender.com`).

---

## 2. Frontend Deployment (Vercel)

1. Sign in to [Vercel.com](https://vercel.com/).
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository `https://github.com/thrisha2020/EMORA.git`.
4. Configure Project Settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `emora-frontend`
5. **Environment Variables:**
   - Name: `VITE_API_BASE`
   - Value: `https://your-backend-name.onrender.com/api` (replace with your Render backend URL)
6. Click **Deploy**.

Vercel will build and host your frontend globally with SSL/HTTPS enabled, which allows camera and microphone access to work seamlessly!

---

## 3. Alternative: Full-Stack Docker Container on Render

Render can also host the entire app (Frontend + Backend) in a single service:
1. Build frontend locally or in Docker: `cd emora-frontend && npm run build`
2. Run FastAPI backend (`uvicorn backend.app.main:app`). When `emora-frontend/dist` exists, FastAPI automatically serves both the API and the SPA frontend from `http://your-app.onrender.com`!
