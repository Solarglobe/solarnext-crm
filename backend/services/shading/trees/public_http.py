"""Bounded retries for public IGN GET requests, including COPC byte ranges."""
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def resilient_session(session):
    if not getattr(session, '_ign_retries_configured', False):
        retries = Retry(total=2, connect=2, read=2, status=2,
                        backoff_factor=.25,
                        status_forcelist=(429, 500, 502, 503, 504),
                        allowed_methods=frozenset(['GET']),
                        respect_retry_after_header=False,
                        raise_on_status=False)
        session.mount('https://', HTTPAdapter(max_retries=retries))
        session.mount('http://', HTTPAdapter(max_retries=retries))
        session._ign_retries_configured = True
    return session
