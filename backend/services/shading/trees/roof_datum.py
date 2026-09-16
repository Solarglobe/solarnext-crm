"""Measured roof datums: classified building returns, with bounded robust fitting."""
import numpy as np


def inside_points(points, polygon):
    points = np.asarray(points)
    result = np.zeros(len(points), dtype=bool)
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if a[1] == b[1]:
            continue
        result ^= ((a[1] > points[:, 1]) != (b[1] > points[:, 1])) & (
            points[:, 0] < (b[0]-a[0])*(points[:, 1]-a[1])/(b[1]-a[1])+a[0])
    return result


def fit_roof(points):
    """Reject minority planes/outliers, without relaxing the measured-height guard.

    A roof needs 20 returns, a majority consensus and two-dimensional support.
    Deterministic samples make repeated analyses reproducible. Ground returns
    must never be passed here as building returns.
    """
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    if len(p) < 20 or not np.isfinite(p).all():
        return None
    A = np.column_stack([p[:, :2], np.ones(len(p))])
    rng = np.random.default_rng(0)
    # Bound the candidate search; final consensus/refit uses every roof return.
    sample = np.arange(len(p)) if len(p) <= 2500 else rng.choice(len(p), 2500, replace=False)
    B, z = A[sample], p[sample, 2]
    best, count = None, 0
    for _ in range(256):
        ids = rng.choice(len(sample), 3, replace=False)
        if abs(np.linalg.det(B[ids])) < .05:
            continue
        coef = np.linalg.solve(B[ids], z[ids])
        mask = np.abs(z-B@coef) <= .15
        if mask.sum() > count:
            best, count = coef, int(mask.sum())
    if best is None:
        return None
    keep = np.abs(p[:, 2]-A@best) <= .15
    for _ in range(3):
        if keep.sum() < 20:
            return None
        coef = np.linalg.lstsq(A[keep], p[keep, 2], rcond=None)[0]
        keep = np.abs(p[:, 2]-A@coef) <= .15
    if keep.sum() < 20 or keep.mean() < .6:
        return None
    if np.linalg.eigvalsh(np.cov(p[keep, :2].T))[0] < .04:
        return None
    coef = np.linalg.lstsq(A[keep], p[keep, 2], rcond=None)[0]
    rms = float(np.sqrt(np.mean((p[keep, 2]-A[keep]@coef)**2)))
    return {'plane': coef, 'rms': rms, 'points': int(keep.sum()),
            'totalPoints': len(p), 'inlierFraction': float(keep.mean())}
