# Publish SUP Chess publicly

This project includes a Render Blueprint at `render.yaml`. It builds the site, hosts the frontend and backend from one public HTTPS address, supports live Socket.IO games, and saves game data to a persistent disk.

1. Put this `sup` folder in a GitHub repository.
2. Sign in to [Render](https://render.com), select **New → Blueprint**, and connect that repository.
3. Approve the `sup-chess` service and deploy it.
4. Render will give you a public `onrender.com` link. Add a custom domain in the service settings whenever you are ready.

The persistent disk is intentional: without it, the local game database would be erased whenever the hosted server restarts. Render web services receive a public URL after deployment, and custom domains can be added from the service settings.
