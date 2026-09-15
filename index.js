const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PS_BASE_URL = 'https://unorth.powerschool.com';

app.post('/scrape-grades', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  let browser;
  try {
    // Launch headless Chromium with Linux flags required by Render free tier
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Emulate desktop browser to pass WAF check
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Load login page
    await page.goto(`${PS_BASE_URL}/public/home.html`, { waitUntil: 'networkidle2', timeout: 30000 });

    // 2. Fill login inputs
    await page.type('#fieldAccount', username);
    await page.type('#fieldPassword', password);

    // 3. Submit login form and await redirect
    await Promise.all([
      page.click('#btn-enter-sign-in'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
    ]);

    // Check for bad credentials
    const pageContent = await page.content();
    if (pageContent.includes('Invalid Username or Password')) {
      await browser.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Wait for schedule table to load
    await page.waitForSelector('td[align="left"]', { timeout: 10000 }).catch(() => null);

    // 4. Scrape courses and grades directly from browser DOM
    const grades = await page.evaluate(() => {
      const results = [];
      const rows = document.querySelectorAll('tr[id^="ccid_"]');

      rows.forEach(row => {
        const courseCell = row.querySelector('td[align="left"]');
        const gradeLink = row.querySelector('a[href*="scores.html"]');

        if (courseCell && gradeLink) {
          const course = courseCell.innerText.split('\n')[0].trim().replace(/&amp;/g, '&');
          const grade = gradeLink.innerText.trim();
          if (course && grade) {
            results.push({ course, grade });
          }
        }
      });

      return results;
    });

    await browser.close();

    if (grades.length === 0) {
      return res.json([{ course: 'Notice', grade: 'Logged in, but no active grades parsed.' }]);
    }

    return res.json(grades);

  } catch (err) {
    if (browser) await browser.close();
    console.error('Puppeteer Scraping Error:', err.message);
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PowerSchool scraper service running on port ${PORT}`);
});
