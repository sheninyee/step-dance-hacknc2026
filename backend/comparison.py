import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.spatial.distance import cdist

# (point A, vertex B, point C) -> angle at B
JOINTS = {
    "l_elbow":    (11, 13, 15), "r_elbow":    (12, 14, 16),
    "l_shoulder": (13, 11, 23), "r_shoulder": (14, 12, 24),
    "l_hip":      (11, 23, 25), "r_hip":      (12, 24, 26),
    "l_knee":     (23, 25, 27), "r_knee":     (24, 26, 28),
}

def joint_angles(lm):
    """(T,33,3) -> (T,J) angles in degrees."""
    cols = []
    for a, b, c in JOINTS.values():
        v1, v2 = lm[:, a] - lm[:, b], lm[:, c] - lm[:, b]
        cos = (v1 * v2).sum(-1) / (np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1) + 1e-8)
        cols.append(np.degrees(np.arccos(np.clip(cos, -1, 1))))
    return np.stack(cols, axis=1)

def fill_nans(x):
    """Linearly interpolate frames where no person was detected."""
    x = x.copy()
    idx = np.arange(len(x))
    for j in range(x.shape[1]):
        bad = np.isnan(x[:, j])
        if bad.all():
            raise ValueError("No pose detected in any frame")
        if bad.any():
            x[bad, j] = np.interp(idx[bad], idx[~bad], x[~bad, j])
    return x

def resample(x, t_ms, fps=15):
    """Put both videos on the same time grid (handles different source fps)."""
    t = (t_ms - t_ms[0]) / 1000.0
    new_t = np.arange(0, t[-1], 1.0 / fps)
    return np.stack([np.interp(new_t, t, x[:, j]) for j in range(x.shape[1])], axis=1)

def features(motion, fps=15, smooth=5, center_posture=False):
    x = joint_angles(motion["landmarks"])
    x = fill_nans(x)
    x = resample(x, motion["t_ms"], fps)
    x = uniform_filter1d(x, size=smooth, axis=0, mode="nearest")   # reduce landmark jitter
    if center_posture:
        x = x - np.median(x, axis=0)   # compare range of motion only, ignore resting posture
    return x

def dtw(a, b, band=None):
    """Returns (path, mean cost per step). Cost = mean abs angle difference across joints (degrees)."""
    cost = cdist(a, b, metric="cityblock") / a.shape[1]
    n, m = cost.shape
    w = max(band or max(n, m), abs(n - m))          # Sakoe-Chiba band
    acc = np.full((n + 1, m + 1), np.inf)
    acc[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(max(1, i - w), min(m, i + w) + 1):
            acc[i, j] = cost[i - 1, j - 1] + min(acc[i - 1, j], acc[i, j - 1], acc[i - 1, j - 1])
    i, j, path = n, m, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        k = np.argmin([acc[i - 1, j - 1], acc[i - 1, j], acc[i, j - 1]])
        i, j = (i - 1, j - 1) if k == 0 else (i - 1, j) if k == 1 else (i, j - 1)
    path.reverse()
    return path, acc[n, m] / len(path)

def compare_motion(motion_a, motion_b, fps=15, warp=True, center_posture=False, scale_deg=20.0):
    """
    warp=True : tolerant to speed/timing differences (DTW).
    warp=False: frame-by-frame, so timing and speed matter too.
    scale_deg : average angle error at which similarity drops to ~37%. Tune to taste.
    """
    a = features(motion_a, fps, center_posture=center_posture)
    b = features(motion_b, fps, center_posture=center_posture)

    if warp:
        path, _ = dtw(a, b, band=fps * 5)           # allow up to ~5 s of timing drift
        ia, ib = map(np.array, zip(*path))
        diff = np.abs(a[ia] - b[ib])
    else:
        n = min(len(a), len(b))
        diff = np.abs(a[:n] - b[:n])

    mean_err = float(diff.mean())
    return {
        "similarity": float(100 * np.exp(-mean_err / scale_deg)),   # 0-100
        "mean_angle_error_deg": mean_err,
        "per_joint_error_deg": dict(zip(JOINTS, diff.mean(axis=0).round(1))),
    }