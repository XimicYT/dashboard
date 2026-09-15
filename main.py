import re
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from curl_cffi import requests
from bs4 import BeautifulSoup

app = FastAPI()
PS_BASE_URL = "https://unorth.powerschool.com"

class Credentials(BaseModel):
    username: str
    password: str

@app.post("/scrape-grades")
def scrape_grades(creds: Credentials):
    # impersonate="chrome124" spoofs Chrome's exact TLS handshake to bypass WAF checks
    session = requests.Session(impersonate="chrome124")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    }

    try:
        # 1. Establish session cookies
        session.get(f"{PS_BASE_URL}/public/home.html", headers=headers, timeout=15)

        # 2. Submit login form
        payload = {
            "dbpw": "",
            "translator_username": "",
            "translator_password": "",
            "translator_ldappassword": "",
            "returnUrl": "",
            "serviceName": "PS Parent Portal",
            "serviceTicket": "",
            "pcasServerUrl": "/",
            "credentialType": "User Id and Password Credential",
            "account": creds.username,
            "pw": creds.password
        }

        login_resp = session.post(
            f"{PS_BASE_URL}/guardian/home.html",
            data=payload,
            headers={
                **headers, 
                "Content-Type": "application/x-www-form-urlencoded", 
                "Referer": f"{PS_BASE_URL}/public/home.html"
            },
            timeout=15
        )

        html = login_resp.text

        if "Invalid Username or Password" in html:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        if "/x-Ring-Enemie-" in html or "Incapsula" in html:
            raise HTTPException(status_code=403, detail="Imperva WAF blocked request")

        # 3. Parse HTML schedule table
        soup = BeautifulSoup(html, "html.parser")
        results = []

        rows = soup.find_all("tr", id=lambda x: x and x.startswith("ccid_"))
        for row in rows:
            course_cell = row.find("td", align="left")
            grade_link = row.find("a", href=re.compile(r"scores\.html"))

            if course_cell and grade_link:
                course_name = course_cell.get_text().strip().split("\n")[0].strip()
                grade_text = grade_link.get_text().strip()
                if course_name and grade_text:
                    results.append({"course": course_name, "grade": grade_text})

        return results if results else [{"course": "Notice", "grade": "Logged in, but no active grades parsed."}]

    except Exception as err:
        if isinstance(err, HTTPException):
            raise err
        raise HTTPException(status_code=500, detail=str(err))
