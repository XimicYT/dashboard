const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

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
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // Load login page using domcontentloaded instead of networkidle2
    await page.goto(`${PS_BASE_URL}/public/home.html`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 20000 
    });

    // Wait for form inputs to render
    await page.waitForSelector('#fieldAccount', { timeout: 10000 });
    await page.type('#fieldAccount', username, { delay: 30 });
    await page.type('#fieldPassword', password, { delay: 30 });

    // Submit form and await DOM render
    await Promise.all([
      page.click('#btn-enter-sign-in'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null)
    ]);

    // Wait until either grade table or login error message appears in DOM
    await page.waitForFunction(() => {
      return document.querySelector('tr[id^="ccid_"]') || 
             document.body.innerText.includes('Invalid Username or Password');
    }, { timeout: 15000 }).catch(() => null);

    const pageContent = await page.content();
    if (pageContent.includes('Invalid Username or Password')) {
      await browser.close();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Extract course grades
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
