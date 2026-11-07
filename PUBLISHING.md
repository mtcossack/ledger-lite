# Publish this starter as a new public GitHub repository

> **Important:** Never make your existing private family repository public, and do not use GitHub's Fork button on it. This is an independent clean project without private Git history.

## Browser method

1. Extract the `ledger-lite-public.zip` archive on your computer.
2. On github.com, choose **New repository** and name it `ledger-lite`. Select **Public**. Leave the checkboxes for adding a README, license and gitignore unchecked.
3. Open the empty repository and choose **uploading an existing file**. Add the extracted project files **including their folders**, and commit them. If GitHub's upload interface doesn't preserve your desired folder structure, use the terminal method below.
4. Confirm the public files do not contain `.local`, `.dev.vars`, `.env`, `.wrangler`, credentials, or real family information.
5. Share the new GitHub repository URL with friends; they can follow the README to set up their own Cloudflare deployment.

## Terminal method

From inside the extracted Ledger Lite project folder:

```bash
git init
git add .
git status
git commit -m "Initial clean Ledger Lite starter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ledger-lite.git
git push -u origin main
```

First create an empty **public** `ledger-lite` repo on GitHub, then replace `YOUR_USERNAME` with your own GitHub username. Inspect `git status` before committing.

**Do not publish any existing private repository history.** This new folder contains no `.git` directory.
