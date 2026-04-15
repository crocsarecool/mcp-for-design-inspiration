/**
 * Run this once to log into Mobbin and save your session cookies.
 * Usage: node login.js
 * A browser window will open — sign in, then press Enter in this terminal.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const COOKIES_FILE = path.join(__dirname, 'mobbin-cookies.json');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://mobbin.com/sign-in');
  console.log('A browser window has opened. Please log in to Mobbin.');
  console.log('Once you are logged in, press Enter here to save your session...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log(`Session saved to ${COOKIES_FILE}`);

  await browser.close();
}

main().catch(console.error);
