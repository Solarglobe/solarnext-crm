from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response
import os
import requests
import re

app = FastAPI()

# =====================================================
# ERPNext configuration
# =====================================================

ERP_URL = os.getenv("ERPNEXT_BASE_URL") or "https://solarnext-crm.fr"

# =====================================================
# Helpers
# =====================================================

def clean_dict(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}

def extract_power_kw(filename):
    match = re.search(r"(\d+[.,]?\d*)\s*kW", filename, re.IGNORECASE)
    if match:
        return match.group(1).replace(",", ".")
    return None

# =====================================================
# /client â€” ESPACE CLIENT (INCHANGÃ‰)
# =====================================================

@app.get("/client")
def client_page(request: Request):

    token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")

    r = requests.get(
        f"{ERP_URL}/api/method/get_client_by_token",
        params={"token": token},
        timeout=10
    )

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="ERPNext error")

    data = r.json().get("message")
    if not data:
        raise HTTPException(status_code=404, detail="Client not found")

    devis = []
    propositions = []

    documents = data.get("documents", {})

    for d in documents.get("devis", []):
        devis.append({
            "label": d.get("label"),
            "file_name": d.get("file_name"),
            "url": d.get("url")
        })

    for p in documents.get("proposition_commerciale", []):
        fname = p.get("file_name", "")
        label = "Etude solaire"
        power = extract_power_kw(fname)
        if power:
            label = f"Etude {power} kWc"

        propositions.append({
            "label": label,
            "file_name": fname,
            "url": p.get("url")
        })

    response = {
        "reference_dossier": data.get("reference_dossier"),
        "statut": data.get("statut"),
        "statut_devis": data.get("statut_devis"),
        "client": clean_dict(data.get("client", {})),
        "adresse": clean_dict(data.get("adresse", {})),
        "projet": clean_dict(data.get("projet", {})),
        "consommation_annuelle_kwh": data.get("consommation_annuelle_kwh"),
        "documents": {
            "devis": devis,
            "proposition_commerciale": propositions
        },
        "conseiller": clean_dict(data.get("conseiller", {}))
    }

    return JSONResponse(content=response)

# =====================================================
# /file â€” PDF CLIENT (VIA SERVER SCRIPT ERPNext)
# =====================================================

@app.get("/file")
def file_endpoint(request: Request):

    token = request.query_params.get("token")
    path = request.query_params.get("path")
    download = request.query_params.get("download") == "1"

    if not token or not path:
        raise HTTPException(status_code=403, detail="Token ou fichier manquant")

    r = requests.get(
    f"{ERP_URL}/api/method/download_client_file",
    params={
        "token": token,
        "path": path
    },
    headers={
        "Accept": "application/octet-stream"
    },
    timeout=20
)

    if r.status_code != 200:
        raise HTTPException(status_code=403, detail="Acces refuse")

    filename = path.split("/")[-1]

   from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response
import os
import requests
import re

app = FastAPI()

# =====================================================
# ERPNext configuration
# =====================================================

ERP_URL = os.getenv("ERPNEXT_BASE_URL") or "https://solarnext-crm.fr"

# =====================================================
# Helpers
# =====================================================

def clean_dict(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}

def extract_power_kw(filename):
    match = re.search(r"(\d+[.,]?\d*)\s*kW", filename, re.IGNORECASE)
    if match:
        return match.group(1).replace(",", ".")
    return None

# =====================================================
# /client â€” ESPACE CLIENT (INCHANGÃ‰)
# =====================================================

@app.get("/client")
def client_page(request: Request):

    token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")

    r = requests.get(
        f"{ERP_URL}/api/method/get_client_by_token",
        params={"token": token},
        timeout=10
    )

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="ERPNext error")

    data = r.json().get("message")
    if not data:
        raise HTTPException(status_code=404, detail="Client not found")

    devis = []
    propositions = []

    documents = data.get("documents", {})

    for d in documents.get("devis", []):
        devis.append({
            "label": d.get("label"),
            "file_name": d.get("file_name"),
            "url": d.get("url")
        })

    for p in documents.get("proposition_commerciale", []):
        fname = p.get("file_name", "")
        label = "Etude solaire"
        power = extract_power_kw(fname)
        if power:
            label = f"Etude {power} kWc"

        propositions.append({
            "label": label,
            "file_name": fname,
            "url": p.get("url")
        })

    response = {
        "reference_dossier": data.get("reference_dossier"),
        "statut": data.get("statut"),
        "statut_devis": data.get("statut_devis"),
        "client": clean_dict(data.get("client", {})),
        "adresse": clean_dict(data.get("adresse", {})),
        "projet": clean_dict(data.get("projet", {})),
        "consommation_annuelle_kwh": data.get("consommation_annuelle_kwh"),
        "documents": {
            "devis": devis,
            "proposition_commerciale": propositions
        },
        "conseiller": clean_dict(data.get("conseiller", {}))
    }

    return JSONResponse(content=response)

# =====================================================
# /file â€” PDF CLIENT (VIA SERVER SCRIPT ERPNext)
# =====================================================

@app.get("/file")
def file_endpoint(request: Request):

    token = request.query_params.get("token")
    path = request.query_params.get("path")
    download = request.query_params.get("download") == "1"

    if not token or not path:
        raise HTTPException(status_code=403, detail="Token ou fichier manquant")

    r = requests.get(
    f"{ERP_URL}/api/method/download_client_file",
    params={
        "token": token,
        "path": path
    },
    headers={
        "Accept": "application/octet-stream"
    },
    timeout=20
)

    if r.status_code != 200:
        raise HTTPException(status_code=403, detail="Acces refuse")

  from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response
import os
import requests
import re

app = FastAPI()

# =====================================================
# ERPNext configuration
# =====================================================

ERP_URL = os.getenv("ERPNEXT_BASE_URL") or "https://solarnext-crm.fr"

# =====================================================
# Helpers
# =====================================================

def clean_dict(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}

def extract_power_kw(filename):
    match = re.search(r"(\d+[.,]?\d*)\s*kW", filename, re.IGNORECASE)
    if match:
        return match.group(1).replace(",", ".")
    return None

# =====================================================
# /client â€” ESPACE CLIENT (INCHANGÃ‰)
# =====================================================

@app.get("/client")
def client_page(request: Request):

    token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")

    r = requests.get(
        f"{ERP_URL}/api/method/get_client_by_token",
        params={"token": token},
        timeout=10
    )

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="ERPNext error")

    data = r.json().get("message")
    if not data:
        raise HTTPException(status_code=404, detail="Client not found")

    devis = []
    propositions = []

    documents = data.get("documents", {})

    for d in documents.get("devis", []):
        devis.append({
            "label": d.get("label"),
            "file_name": d.get("file_name"),
            "url": d.get("url")
        })

    for p in documents.get("proposition_commerciale", []):
        fname = p.get("file_name", "")
        label = "Etude solaire"
        power = extract_power_kw(fname)
        if power:
            label = f"Etude {power} kWc"

        propositions.append({
            "label": label,
            "file_name": fname,
            "url": p.get("url")
        })

    response = {
        "reference_dossier": data.get("reference_dossier"),
        "statut": data.get("statut"),
        "statut_devis": data.get("statut_devis"),
        "client": clean_dict(data.get("client", {})),
        "adresse": clean_dict(data.get("adresse", {})),
        "projet": clean_dict(data.get("projet", {})),
        "consommation_annuelle_kwh": data.get("consommation_annuelle_kwh"),
        "documents": {
            "devis": devis,
            "proposition_commerciale": propositions
        },
        "conseiller": clean_dict(data.get("conseiller", {}))
    }

    return JSONResponse(content=response)

# =====================================================
# /file â€” PDF CLIENT (VIA SERVER SCRIPT ERPNext)
# =====================================================

@app.get("/file")
def file_endpoint(request: Request):

    token = request.query_params.get("token")
    path = request.query_params.get("path")
    download = request.query_params.get("download") == "1"

    if not token or not path:
        raise HTTPException(status_code=403, detail="Token ou fichier manquant")

    r = requests.get(
    f"{ERP_URL}/api/method/download_client_file",
    params={
        "token": token,
        "path": path
    },
    headers={
        "Accept": "application/octet-stream"
    },
    timeout=20
)

    if r.status_code != 200:
        raise HTTPException(status_code=403, detail="Acces refuse")

    filename = path.split("/")[-1]

    filename = path.split("/")[-1]

    return Response(
        content=r.content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"'
                if download
                else f'inline; filename="{filename}"'
            ),
            "Cache-Control": "no-store"
        }
    )



