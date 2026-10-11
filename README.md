# RIFT//ZERO — tactical browser FPS prototype (V14 multiplayer scene-entry fix)

A compact first-person browser shooter prototype using Three.js, Express and WebSocket. The visual direction is industrial/tactical: concrete, steel cover, restrained hazard markings and simple weapon/character geometry.

## Requirements
- Node.js 20 or newer
- A modern desktop browser with WebGL

## Run locally (Windows 10/11)
1. Install Node.js LTS from https://nodejs.org/.
2. Extract the ZIP.
3. Open Command Prompt in the extracted `rift-zero-3d` folder.
4. Run:
   ```bat
   npm install
   npm run check
   npm start
   ```
5. Open http://localhost:3000.

## Controls
- `W A S D`: move
- Mouse: look around (click the arena to lock the pointer)
- Left mouse button: fire
- `SHIFT`: dash
- `Q`: time shift / slow ability
- `ESC`: release mouse / pause

## Online 1v1
Deploy one instance of this Node app. Open the same public URL in two browsers/devices and enter the same room code. `QUICK` is the default. The current prototype keeps room state in process memory; it is not designed for multiple server instances or reliable ranked matches yet.

## Deploy to Render
1. Create a GitHub repository and upload the contents of this folder (not the ZIP itself).
2. In Render, create **New → Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Deploy. Render sets `PORT` automatically; the server binds to `0.0.0.0`.
5. Open the deployed HTTPS URL. WebSocket uses `wss` automatically on HTTPS.

## Prototype limitations — read before publishing
- This is a gameplay prototype, not a finished competitive shooter.
- The server currently relays player positions and room state but does **not** authoritatively validate movement, line of sight, fire rate, or hits. Do not use for ranked or monetized competitive play yet.
- The slow-time ability in online mode applies a short slow status to the opponent, but the server-side effect is not yet a robust anti-cheat simulation.
- The bot is a simple local practice target/opponent, not advanced AI. Training score is local.
- No persistent accounts, database, matchmaking, anti-cheat, audio, mobile touch controls, or payments are included.
- Render free instances may sleep when idle, causing the first connection to take longer.
- WebGL performance depends on the device/browser. Best tested on desktop.

## What has been checked in this package
- JavaScript syntax checks are provided as `npm run check`.
- The server includes `/health` for a basic health response.
- This package has not been verified through a live two-client internet match or a Render deployment in this environment. Run the commands above and test both local and deployed sessions before sharing publicly.


## Обновление combat-механик

- Добавлен экран смерти и ручное возрождение с восстановлением здоровья.
- Переработана 3D-модель автомата: приклад, ствольная коробка, магазин, оптика, длинный ствол и вспышка выстрела; добавлены отдача и ограничение скорострельности.
- Тренировочный бот получил более детальную модель, анимацию конечностей, стрельбу и простое обходное движение вокруг препятствий.
- Пули проверяют столкновение с укрытиями, а движение игрока и бота блокируется коллайдерами. Для сетевого режима сервер также проверяет перемещение и не возрождает игрока автоматически после смерти.

Проверка этой сборки: синтаксис JavaScript и целостность ZIP проверены. Полный запуск в браузере и сетевой матч в этой среде не выполнялись, поэтому после установки зависимостей нужно проверить игру локально.


## Обновлённое управление
- WASD — движение, мышь — обзор (курсор захватывается игрой).
- Удерживать ЛКМ — автоматическая стрельба из карабина; ПКМ — прицеливание с уменьшением поля зрения.
- R — перезарядка; 1/2 — выбор оружия; Space — прыжок; Shift — рывок; Q — способность.
- В тренировочном режиме попадания различаются по зоне: голова — 52, корпус — 26, ноги — 13 единиц урона. В сетевом режиме сервер принимает и ограничивает заявленный урон; это игровой прототип, не античит-защищённая система.
- Добавлены ступенчатые возвышения, платформы и новые укрытия для смены высоты и фланговых маршрутов.


## Public multiplayer beta (Render)

This project already includes an Express HTTP server and a WebSocket endpoint at `/ws`. For the first public test, deploy it as a **Render Web Service** from GitHub:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Instance: use Free only for a short test; free services can spin down after 15 minutes without traffic. For an always-available playtest, select a paid instance.

After deployment, open the public `https://<your-service>.onrender.com` URL in two browser windows/devices. Enter the same room code in both clients. Render supports WebSocket connections, and the client automatically switches to `wss://` on HTTPS.

### Multiplayer beta limits

- Rooms currently support two players each.
- This is an initial public playtest, not a production-grade authoritative game server: movement and hit messages still need server-side validation, rate limiting, reconnect handling, and load testing before opening it widely.
- Check `https://<your-service>.onrender.com/health` for the service health response.


## V14 fix: second client stays at the menu

The browser client now checks the actual menu/game visibility in addition to the `running` flag. If an old session flag says the game is running while the menu is still visible, the client starts the online arena again. A fresh join clears stale player identity/remotes, and startup errors are shown in the menu status. This is a targeted fix; validate with two real browser clients after deploying.
