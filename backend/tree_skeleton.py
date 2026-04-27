"""
Space Colonization tree skeleton generator.
Replaces lsystem.py with a top-down approach:
  1. Crown outline (superellipse) from user data
  2. Sector-based attractor distribution
  3. Deterministic trunk + primary branches
  4. Space Colonization for fine branches
  5. da Vinci pipe model for thickness
  6. Root generation
"""
import math
import random
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class CrownOutline:
    center_x: float
    center_y: float
    semi_axis_x: float
    semi_axis_y: float
    eccentricity_x: float
    superellipse_n: float
    points: List[Tuple[float, float]] = field(default_factory=list)


@dataclass
class Sector:
    root_id: str
    root_name: str
    subtree_size: int
    mastery_score: float
    angle_start: float
    angle_end: float
    angle_center: float
    attractor_points: List[Tuple[float, float]] = field(default_factory=list)


@dataclass
class BranchNode:
    """Internal node in the Space Colonization graph."""
    position: Tuple[float, float]
    parent_index: Optional[int]
    children_indices: List[int] = field(default_factory=list)
    root_id: str = ""
    depth: int = 0
    thickness: float = 0.0


@dataclass
class ForkPoint:
    position: Tuple[float, float]
    radius: float
    is_primary: bool
    root_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _count_descendants(node_id: str, children_map: Dict[str, List[str]]) -> int:
    count = 0
    for cid in children_map.get(node_id, []):
        count += 1 + _count_descendants(cid, children_map)
    return count


def _max_depth(node_id: str, children_map: Dict[str, List[str]], current: int = 0) -> int:
    children = children_map.get(node_id, [])
    if not children:
        return current
    return max(_max_depth(cid, children_map, current + 1) for cid in children)


def _point_in_superellipse(
    x: float, y: float,
    cx: float, cy: float,
    a: float, b: float, n: float,
) -> bool:
    dx = (x - cx) / a if a != 0 else 0
    dy = (y - cy) / b if b != 0 else 0
    return (abs(dx) ** n + abs(dy) ** n) <= 1.0


def _project_onto_superellipse(
    x: float, y: float,
    cx: float, cy: float,
    a: float, b: float, n: float,
) -> Tuple[float, float]:
    """Project a point onto the superellipse boundary along radial direction."""
    dx = x - cx
    dy = y - cy
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return (cx, cy - b * 0.1)

    # Binary search for t where (t*dx/a)^n + (t*dy/b)^n = 1
    t_lo, t_hi = 0.0, 1.0
    for _ in range(30):
        t_mid = (t_lo + t_hi) / 2
        nx = t_mid * dx / a if a else 0
        ny = t_mid * dy / b if b else 0
        val = abs(nx) ** n + abs(ny) ** n
        if val < 1.0:
            t_lo = t_mid
        else:
            t_hi = t_mid
    t = (t_lo + t_hi) / 2
    return (cx + t * dx, cy + t * dy)


def _sample_superellipse(
    cx: float, cy: float,
    a: float, b: float, n: float,
    num_points: int = 64,
) -> List[Tuple[float, float]]:
    points = []
    for i in range(num_points):
        theta = 2 * math.pi * i / num_points
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        # Parametric superellipse
        x = a * _sgn(cos_t) * (abs(cos_t) ** (2 / n))
        y = b * _sgn(sin_t) * (abs(sin_t) ** (2 / n))
        points.append((cx + x, cy + y))
    return points


def _sgn(x: float) -> float:
    if x > 0:
        return 1.0
    elif x < 0:
        return -1.0
    return 0.0


def _uuid_seed(node_ids: List[str]) -> int:
    if not node_ids:
        return 42
    return hash(node_ids[0]) % (2 ** 32)


# ---------------------------------------------------------------------------
# Step 1: Compute tree statistics
# ---------------------------------------------------------------------------

def _compute_tree_stats(tree_data: List[Dict]):
    parent_map: Dict[str, Optional[str]] = {}
    children_map: Dict[str, List[str]] = {}
    node_by_id: Dict[str, Dict] = {n["id"]: n for n in tree_data}

    for node in tree_data:
        pid = node.get("parent_id")
        parent_map[node["id"]] = pid
        if pid:
            children_map.setdefault(pid, []).append(node["id"])

    roots = [n for n in tree_data if n.get("parent_id") is None]
    if not roots:
        roots = [n for n in tree_data if n.get("depth") == 0]
    if not roots:
        return None  # empty tree

    root_stats: List[Dict] = []
    global_max_depth = 0
    total_stability = 0.0
    total_mastery = 0.0
    reviewed_count = 0
    for root in roots:
        desc = _count_descendants(root["id"], children_map)
        depth = _max_depth(root["id"], children_map)
        global_max_depth = max(global_max_depth, depth)
        stability = root.get("stability", 0.0)
        mastery = root.get("mastery_score", 0.0)
        review_count = root.get("review_count", 0)
        total_stability += stability
        total_mastery += mastery
        if review_count > 0:
            reviewed_count += 1
        root_stats.append({
            "id": root["id"],
            "name": root["name"],
            "descendants": desc,
            "depth": depth,
            "subtree_size": desc + 1,  # includes self
            "mastery_score": mastery,
            "stability": stability,
            "difficulty": root.get("difficulty", 0.3),
            "review_count": review_count,
            "review_state": root.get("review_state", "new"),
        })

    total_nodes = len(tree_data)
    n_roots = len(roots)
    width_depth_ratio = n_roots / max(global_max_depth, 1)
    width_depth_ratio = max(0.1, min(10.0, width_depth_ratio))

    max_subtree = max(rs["subtree_size"] for rs in root_stats)
    max_subtree_ratio = max_subtree / total_nodes if total_nodes > 0 else 0

    # Aggregate FSRS health metrics
    avg_stability = round(total_stability / n_roots, 2) if n_roots > 0 else 0.0
    avg_mastery = round(total_mastery / n_roots, 4) if n_roots > 0 else 0.0
    review_coverage = round(reviewed_count / n_roots, 4) if n_roots > 0 else 0.0

    # Growth multiplier: uniform scalar applied to all tree dimensions.
    # Reflects "developmental maturity" independent of structure.
    # stability_norm 0→0, ~5→0.52, ~30→0.99
    stability_norm = min(1.0, math.log(1 + avg_stability) / math.log(31)) if avg_stability > 0 else 0.0
    maturity = 0.3 * review_coverage + 0.7 * stability_norm
    growth_multiplier = round(0.3 + 2.2 * maturity, 4)  # 0.3 (seedling) → 2.5 (fully mature)

    health = {
        "avg_stability": avg_stability,
        "avg_mastery": avg_mastery,
        "review_coverage": review_coverage,
        "total_nodes": total_nodes,
        "reviewed_nodes": reviewed_count,
        "growth_multiplier": growth_multiplier,
    }

    return (
        children_map, parent_map, root_stats,
        total_nodes, global_max_depth,
        width_depth_ratio, max_subtree_ratio, health,
    )


# ---------------------------------------------------------------------------
# Step 2: Crown outline
# ---------------------------------------------------------------------------

def _generate_crown_outline(
    canvas_w: int, canvas_h: int,
    total_nodes: int,
    width_depth_ratio: float,
    max_subtree_ratio: float,
    trunk_top: Tuple[float, float],
    seed: int,
    growth_multiplier: float = 1.0,
) -> CrownOutline:
    rng = random.Random(seed)

    # Superellipse exponent n: wide trees -> higher n (flatter top), deep trees -> lower n
    if width_depth_ratio > 1.2:
        n = 2.5 + min(1.0, (width_depth_ratio - 1.2) * 1.25)  # 2.5 ~ 3.5
    elif width_depth_ratio < 0.8:
        n = 2.0
    else:
        n = 2.0 + (width_depth_ratio - 0.8) * (0.5 / 0.4)  # 2.0 ~ 2.5

    # Area = k * log(total_nodes + 1), mapped to pixel area
    # Target area in pixels
    target_area = canvas_w * canvas_h * 0.25 * math.log(max(total_nodes, 2) + 1) / math.log(50)

    # Aspect ratio from width_depth_ratio
    if width_depth_ratio > 1.2:
        aspect = min(2.0, width_depth_ratio)  # wider
    elif width_depth_ratio < 0.8:
        aspect = max(0.5, width_depth_ratio)  # taller
    else:
        aspect = 1.0

    # semi_axis_y * semi_axis_x * (gamma(1+1/n)^2 / gamma(1+2/n)) ≈ area for superellipse
    # Simplification: approximate area as pi*a*b (close enough for n near 2)
    area_factor = math.pi
    semi_axis_y = math.sqrt(target_area / (area_factor * aspect))
    semi_axis_x = semi_axis_y * aspect

    # Apply growth multiplier — scales crown linearly, keeps proportions
    semi_axis_x *= growth_multiplier
    semi_axis_y *= growth_multiplier

    # Clamp to canvas
    semi_axis_x = min(semi_axis_x, canvas_w * 0.42)
    semi_axis_y = min(semi_axis_y, canvas_h * 0.40)

    # Center: just above trunk top
    center_x = canvas_w / 2
    center_y = trunk_top[1] - semi_axis_y * 0.4

    # Eccentricity shift for dominant subtree
    eccentricity_x = 0.0
    if max_subtree_ratio > 0.5:
        eccentricity_x = semi_axis_x * (max_subtree_ratio - 0.5) * 0.6
        center_x += eccentricity_x

    points = _sample_superellipse(center_x, center_y, semi_axis_x, semi_axis_y, n)

    return CrownOutline(
        center_x=center_x,
        center_y=center_y,
        semi_axis_x=semi_axis_x,
        semi_axis_y=semi_axis_y,
        eccentricity_x=eccentricity_x,
        superellipse_n=n,
        points=points,
    )


# ---------------------------------------------------------------------------
# Step 3: Sector-based attractor distribution
# ---------------------------------------------------------------------------

def _distribute_attractors(
    crown: CrownOutline,
    root_stats: List[Dict],
    total_nodes: int,
    seed: int,
    growth_multiplier: float = 1.0,
) -> List[Sector]:
    rng = random.Random(seed)

    if not root_stats:
        return []

    # Weighted by subtree_size only — uniform, no spatial mastery bias
    weights = []
    for rs in root_stats:
        w = float(rs["subtree_size"])
        weights.append(w)
    total_weight = sum(weights)

    # Assign angular sectors from -pi/2 (top) going clockwise
    sectors: List[Sector] = []
    current_angle = -math.pi
    for i, rs in enumerate(root_stats):
        fraction = weights[i] / total_weight
        span = fraction * 2 * math.pi
        angle_start = current_angle
        angle_end = current_angle + span
        angle_center = (angle_start + angle_end) / 2

        # Sector attractor count proportional to weight, scaled by growth
        total_attractors = int((50 + 3 * total_nodes) * growth_multiplier)
        total_attractors = min(500, total_attractors)
        sector_count = max(3, int(total_attractors * weights[i] / total_weight))

        # Generate attractor points via reject sampling inside superellipse
        attractors: List[Tuple[float, float]] = []
        attempts = 0
        while len(attractors) < sector_count and attempts < sector_count * 30:
            # Uniform random in bounding box
            x = rng.uniform(
                crown.center_x - crown.semi_axis_x,
                crown.center_x + crown.semi_axis_x,
            )
            y = rng.uniform(
                crown.center_y - crown.semi_axis_y,
                crown.center_y + crown.semi_axis_y,
            )

            if _point_in_superellipse(
                x, y,
                crown.center_x, crown.center_y,
                crown.semi_axis_x, crown.semi_axis_y,
                crown.superellipse_n,
            ):
                # Check angular sector
                dx = x - crown.center_x
                dy = y - crown.center_y
                angle = math.atan2(dy, dx)
                if _angle_in_range(angle, angle_start, angle_end):
                    # Edge density falloff: lower acceptance near superellipse boundary
                    dx_n = abs((x - crown.center_x) / crown.semi_axis_x) if crown.semi_axis_x != 0 else 0
                    dy_n = abs((y - crown.center_y) / crown.semi_axis_y) if crown.semi_axis_y != 0 else 0
                    t = dx_n ** crown.superellipse_n + dy_n ** crown.superellipse_n
                    if rng.random() > (1.0 - t * t):
                        attempts += 1
                        continue
                    attractors.append((x, y))
            attempts += 1

        sectors.append(Sector(
            root_id=rs["id"],
            root_name=rs["name"],
            subtree_size=rs["subtree_size"],
            mastery_score=rs.get("mastery_score", 0.0),
            angle_start=angle_start,
            angle_end=angle_end,
            angle_center=angle_center,
            attractor_points=attractors,
        ))

        current_angle = angle_end

    return sectors


def _angle_in_range(angle: float, start: float, end: float) -> bool:
    """Check if angle is within [start, end], handling wraparound."""
    # Normalize all to [-pi, pi]
    a = math.atan2(math.sin(angle), math.cos(angle))
    if start <= end:
        return start <= a <= end
    # Wraps around
    return a >= start or a <= end


# ---------------------------------------------------------------------------
# Step 4: Trunk and primary branches
# ---------------------------------------------------------------------------

def _generate_trunk(
    canvas_w: int, canvas_h: int,
    ground_y: float,
    total_nodes: int,
    n_roots: int,
    user_uuid_seed: int,
    growth_multiplier: float = 1.0,
) -> Tuple[List[Dict], Tuple[float, float], Tuple[float, float], float, float]:
    """Returns (trunk_branches, trunk_base, trunk_top, trunk_base_thickness, trunk_top_thickness)"""

    rng = random.Random(user_uuid_seed)

    # Trunk height
    depth_factor = min(1.0, 0.4 + math.log2(max(total_nodes, 2)) * 0.08)
    node_factor = min(1.0, 0.5 + math.log2(max(total_nodes, 2)) * 0.07)
    trunk_height = canvas_h * 0.20 * depth_factor * node_factor + canvas_h * 0.15
    trunk_height *= growth_multiplier

    trunk_base = (canvas_w / 2, ground_y)
    trunk_top = (canvas_w / 2, ground_y - trunk_height)

    # Trunk thickness
    root_factor = min(1.0, 0.5 + n_roots * 0.1)
    node_thick_factor = min(1.0, 0.6 + math.log2(max(total_nodes, 2)) * 0.07)
    trunk_base_thickness = 10 + 15 * root_factor * node_thick_factor
    trunk_top_thickness = trunk_base_thickness * 0.4  # 2.5x ratio

    # S-curve: 3 control points (bottom, mid-offset, top)
    # Mid control point shifted by UUID seed
    mid_offset_x = (rng.random() - 0.5) * canvas_w * 0.04  # slight S bend
    mid_y = trunk_base[1] - trunk_height * 0.5

    # Generate 6 tapered segments along the S-curve
    trunk_branches: List[Dict] = []
    trunk_segments = 6
    for i in range(trunk_segments):
        t0 = i / trunk_segments
        t1 = (i + 1) / trunk_segments

        # Points on quadratic bezier: P = (1-t)^2*P0 + 2*(1-t)*t*P1 + t^2*P2
        p0 = _quad_bezier_point(
            trunk_base, (trunk_base[0] + mid_offset_x, mid_y), trunk_top, t0
        )
        p1 = _quad_bezier_point(
            trunk_base, (trunk_base[0] + mid_offset_x, mid_y), trunk_top, t1
        )
        t_mid = (t0 + t1) / 2
        pm = _quad_bezier_point(
            trunk_base, (trunk_base[0] + mid_offset_x, mid_y), trunk_top, t_mid
        )

        # Thickness at this segment (tapered)
        thickness_start = trunk_base_thickness - (trunk_base_thickness - trunk_top_thickness) * t0
        thickness_end = trunk_base_thickness - (trunk_base_thickness - trunk_top_thickness) * t1
        thickness = (thickness_start + thickness_end) / 2

        # Control points with small perpendicular perturbation
        dx = p1[0] - p0[0]
        dy = p1[1] - p0[1]
        seg_len = math.hypot(dx, dy)
        if seg_len > 0:
            perp_angle = math.atan2(-dx, dy)
        else:
            perp_angle = 0

        rng.seed(user_uuid_seed + i)
        offset1 = rng.uniform(-2, 2)
        offset2 = rng.uniform(-2, 2)

        cp1 = (p0[0] + (pm[0] - p0[0]) * 0.67 + offset1 * math.cos(perp_angle),
               p0[1] + (pm[1] - p0[1]) * 0.67 + offset1 * math.sin(perp_angle))
        cp2 = (pm[0] + (p1[0] - pm[0]) * 0.33 + offset2 * math.cos(perp_angle),
               pm[1] + (p1[1] - pm[1]) * 0.33 + offset2 * math.sin(perp_angle))

        trunk_branches.append({
            "start": list(p0),
            "end": list(p1),
            "control1": list(cp1),
            "control2": list(cp2),
            "thickness": thickness,
            "node_id": "__trunk__",
            "depth": -1,
            "start_thickness": thickness_start,
            "end_thickness": thickness_end,
        })

    return trunk_branches, trunk_base, trunk_top, trunk_base_thickness, trunk_top_thickness


def _quad_bezier_point(p0, p1, p2, t):
    """Evaluate quadratic bezier at t."""
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
    return (x, y)


def _generate_primary_branches(
    trunk_base: Tuple[float, float],
    trunk_top: Tuple[float, float],
    trunk_height: float,
    trunk_base_thickness: float,
    trunk_top_thickness: float,
    root_stats: List[Dict],
    crown: CrownOutline,
    sectors: List[Sector],
    seed: int,
) -> Tuple[List[Dict], List[BranchNode], List[ForkPoint], float]:
    """
    Returns (primary_branches, initial_sc_nodes, fork_points, trunk_base_thickness_at_fork)
    """
    rng = random.Random(seed)

    primary_branches: List[Dict] = []
    initial_nodes: List[BranchNode] = []
    fork_points: List[ForkPoint] = []

    n_branches = len(root_stats)
    if n_branches == 0:
        return primary_branches, initial_nodes, fork_points, trunk_top_thickness

    # Fork heights distributed 60%-85% up trunk
    for i, rs in enumerate(root_stats):
        if n_branches == 1:
            fork_frac = 0.72
        else:
            fork_frac = 0.60 + (0.25 * i / (n_branches - 1))

        fork_y = trunk_base[1] - trunk_height * fork_frac

        # Trunk thickness at fork point (linearly interpolated)
        trunk_thickness_at_fork = trunk_base_thickness + (trunk_top_thickness - trunk_base_thickness) * fork_frac

        # Direction toward sector center
        sector = sectors[i] if i < len(sectors) else sectors[0]
        target_x = crown.center_x + crown.semi_axis_x * 0.5 * math.cos(sector.angle_center)
        target_y = crown.center_y + crown.semi_axis_y * 0.3 * math.sin(sector.angle_center)

        fork_pos = (trunk_base[0], fork_y)

        # Primary branch: bezier from fork to a point toward the sector
        branch_length = min(crown.semi_axis_x, crown.semi_axis_y) * 0.6
        rng_local = random.Random(seed + i * 137)
        end_x = fork_pos[0] + (target_x - fork_pos[0]) * 0.5
        end_y = fork_pos[1] + (target_y - fork_pos[1]) * 0.5

        # Control points
        cp1_x = fork_pos[0] + (end_x - fork_pos[0]) * 0.33 + rng_local.uniform(-5, 5)
        cp1_y = fork_pos[1] + (end_y - fork_pos[1]) * 0.33
        cp2_x = fork_pos[0] + (end_x - fork_pos[0]) * 0.67 + rng_local.uniform(-5, 5)
        cp2_y = fork_pos[1] + (end_y - fork_pos[1]) * 0.67

        # Thickness: da Vinci pipe model will refine later, initial estimate
        branch_thickness = trunk_thickness_at_fork * 0.5

        primary_branches.append({
            "start": list(fork_pos),
            "end": [end_x, end_y],
            "control1": [cp1_x, cp1_y],
            "control2": [cp2_x, cp2_y],
            "thickness": branch_thickness,
            "node_id": rs["id"],
            "depth": 0,
            "start_thickness": trunk_thickness_at_fork * 0.6,
            "end_thickness": trunk_thickness_at_fork * 0.25,
            "is_terminal": False,
        })

        # Fork point sphere
        fork_radius = trunk_thickness_at_fork * 0.35
        fork_points.append(ForkPoint(
            position=fork_pos,
            radius=fork_radius,
            is_primary=True,
            root_id=rs["id"],
        ))

        # Space Colonization starting node at branch tip
        initial_nodes.append(BranchNode(
            position=(end_x, end_y),
            parent_index=None,
            root_id=rs["id"],
            depth=1,
            thickness=0,
        ))

    return primary_branches, initial_nodes, fork_points, trunk_top_thickness


# ---------------------------------------------------------------------------
# Step 5: Space Colonization
# ---------------------------------------------------------------------------

def _space_colonization(
    initial_nodes: List[BranchNode],
    sectors: List[Sector],
    crown: CrownOutline,
    seed: int,
    growth_step: float = 5.0,
    kill_distance: float = 8.0,
    influence_radius: float = 50.0,
    max_iterations: int = 300,
    max_branches: int = 600,
) -> List[BranchNode]:
    rng = random.Random(seed)

    # Collect all attractors with sector mapping
    all_attractors: List[Tuple[float, float]] = []
    attractor_sector_idx: List[int] = []
    for si, sector in enumerate(sectors):
        for pt in sector.attractor_points:
            all_attractors.append(pt)
            attractor_sector_idx.append(si)

    alive_nodes = list(initial_nodes)
    alive_attractors = list(range(len(all_attractors)))  # indices into all_attractors

    for iteration in range(max_iterations):
        if len(alive_nodes) >= max_branches:
            break
        if not alive_attractors:
            break

        # For each attractor, find nearest node within influence radius
        node_attractors: Dict[int, List[int]] = {}  # node_index -> [attractor_indices in alive_attractors]

        for ai_idx, ai in enumerate(alive_attractors):
            ax, ay = all_attractors[ai]
            best_node = -1
            best_dist = influence_radius

            for ni, node in enumerate(alive_nodes):
                d = math.hypot(node.position[0] - ax, node.position[1] - ay)
                if d < best_dist:
                    best_dist = d
                    best_node = ni

            if best_node >= 0:
                node_attractors.setdefault(best_node, []).append(ai_idx)

        if not node_attractors:
            break

        # Grow each node toward its attractors
        nodes_to_add: List[BranchNode] = []
        attractors_to_kill: set = set()

        for ni, ai_indices in node_attractors.items():
            node = alive_nodes[ni]

            # Average direction toward attractors
            avg_dx, avg_dy = 0.0, 0.0
            for ai_idx in ai_indices:
                ai = alive_attractors[ai_idx]
                ax, ay = all_attractors[ai]
                dx = ax - node.position[0]
                dy = ay - node.position[1]
                d = math.hypot(dx, dy)
                if d > 0:
                    avg_dx += dx / d
                    avg_dy += dy / d
            d_avg = math.hypot(avg_dx, avg_dy)
            if d_avg > 0:
                avg_dx /= d_avg
                avg_dy /= d_avg

            # Sector bias (15% weight)
            sector = _find_sector_for_root(sectors, node.root_id)
            if sector:
                # Direction toward sector center from crown center
                bias_dx = math.cos(sector.angle_center)
                bias_dy = math.sin(sector.angle_center)
                growth_dx = avg_dx * 0.85 + bias_dx * 0.15
                growth_dy = avg_dy * 0.85 + bias_dy * 0.15
            else:
                growth_dx = avg_dx
                growth_dy = avg_dy

            # Normalize
            d_g = math.hypot(growth_dx, growth_dy)
            if d_g > 0:
                growth_dx /= d_g
                growth_dy /= d_g

            # Small random perturbation
            rng.seed(seed + iteration * 1000 + ni)
            perturb_angle = rng.uniform(-0.05, 0.05)
            cos_p = math.cos(perturb_angle)
            sin_p = math.sin(perturb_angle)
            growth_dx, growth_dy = (
                growth_dx * cos_p - growth_dy * sin_p,
                growth_dx * sin_p + growth_dy * cos_p,
            )

            # New position
            new_x = node.position[0] + growth_dx * growth_step
            new_y = node.position[1] + growth_dy * growth_step

            # Hard boundary: project onto superellipse if outside
            if not _point_in_superellipse(
                new_x, new_y,
                crown.center_x, crown.center_y,
                crown.semi_axis_x, crown.semi_axis_y,
                crown.superellipse_n,
            ):
                new_x, new_y = _project_onto_superellipse(
                    new_x, new_y,
                    crown.center_x, crown.center_y,
                    crown.semi_axis_x, crown.semi_axis_y,
                    crown.superellipse_n,
                )
                # If projection is too close to current position, skip
                if math.hypot(new_x - node.position[0], new_y - node.position[1]) < 1:
                    continue

            new_node = BranchNode(
                position=(new_x, new_y),
                parent_index=ni,
                root_id=node.root_id,
                depth=node.depth + 1,
                thickness=0,
            )
            nodes_to_add.append(new_node)

            # Check kill distance
            for ai_idx in ai_indices:
                ai = alive_attractors[ai_idx]
                ax, ay = all_attractors[ai]
                if math.hypot(new_x - ax, new_y - ay) < kill_distance:
                    attractors_to_kill.add(ai_idx)

        # Apply growth
        for new_node in nodes_to_add:
            if len(alive_nodes) >= max_branches:
                break
            parent_idx = new_node.parent_index
            alive_nodes[parent_idx].children_indices.append(len(alive_nodes))
            alive_nodes.append(new_node)

        # Remove consumed attractors
        alive_attractors = [
            ai for idx, ai in enumerate(alive_attractors)
            if idx not in attractors_to_kill
        ]

    return alive_nodes


def _find_sector_for_root(sectors: List[Sector], root_id: str) -> Optional[Sector]:
    for s in sectors:
        if s.root_id == root_id:
            return s
    return sectors[0] if sectors else None


# ---------------------------------------------------------------------------
# Step 6: da Vinci pipe model
# ---------------------------------------------------------------------------

def _compute_thicknesses(
    all_nodes: List[BranchNode],
    trunk_base_thickness: float,
    trunk_top_thickness: float,
    min_thickness: float = 1.0,
    ref_thickness: float = 8.0,
) -> None:
    """Apply da Vinci pipe model: parent cross-section = sum of children."""
    if not all_nodes:
        return

    # Bottom-up: count leaves in each subtree
    leaf_counts: List[int] = [0] * len(all_nodes)

    def _count_leaves(idx: int) -> int:
        node = all_nodes[idx]
        if not node.children_indices:
            leaf_counts[idx] = 1
            return 1
        total = sum(_count_leaves(c) for c in node.children_indices)
        leaf_counts[idx] = total
        return total

    # Start from roots (nodes with no parent)
    root_indices = [i for i, n in enumerate(all_nodes) if n.parent_index is None]
    for ri in root_indices:
        _count_leaves(ri)

    max_leaves = max(leaf_counts) if leaf_counts else 1

    # Top-down: assign thickness based on leaf count
    for i, node in enumerate(all_nodes):
        if not node.children_indices:
            # Terminal node
            node.thickness = min_thickness
        else:
            # Power-law scaling: thickness = ref * (leaf_count / max_leaves)^0.6
            ratio = leaf_counts[i] / max_leaves if max_leaves > 0 else 0
            node.thickness = max(min_thickness, ref_thickness * (ratio ** 0.6))


# ---------------------------------------------------------------------------
# Step 7: Convert BranchNodes to Bezier Branches
# ---------------------------------------------------------------------------

def _nodes_to_bezier_branches(
    all_nodes: List[BranchNode],
    seed: int,
    mastery_by_root: Dict[str, float] | None = None,
) -> List[Dict]:
    branches: List[Dict] = []
    mastery_lookup = mastery_by_root or {}

    for i, node in enumerate(all_nodes):
        if node.parent_index is None:
            continue

        parent = all_nodes[node.parent_index]
        start = parent.position
        end = node.position

        dx = end[0] - start[0]
        dy = end[1] - start[1]
        seg_len = math.hypot(dx, dy)
        if seg_len < 1:
            continue

        # Perpendicular perturbation for control points
        rng = random.Random(seed + i * 7)
        if seg_len > 0:
            perp_angle = math.atan2(-dx, dy)
        else:
            perp_angle = 0

        max_offset = seg_len * 0.25
        offset1 = rng.uniform(-max_offset, max_offset)
        offset2 = rng.uniform(-max_offset, max_offset)

        cp1_x = start[0] + dx * 0.33 + offset1 * math.cos(perp_angle)
        cp1_y = start[1] + dy * 0.33 + offset1 * math.sin(perp_angle)
        cp2_x = start[0] + dx * 0.67 + offset2 * math.cos(perp_angle)
        cp2_y = start[1] + dy * 0.67 + offset2 * math.sin(perp_angle)

        start_thickness = parent.thickness if parent.thickness > 0 else 2.0
        end_thickness = node.thickness if node.thickness > 0 else 1.0
        # Taper: end_thickness should be 40% of start_thickness minimum
        end_thickness = min(end_thickness, start_thickness * 0.95)
        end_thickness = max(end_thickness, start_thickness * 0.3)

        is_terminal = len(node.children_indices) == 0
        mastery = mastery_lookup.get(node.root_id, 0.0)

        branches.append({
            "start": list(start),
            "end": list(end),
            "control1": [cp1_x, cp1_y],
            "control2": [cp2_x, cp2_y],
            "thickness": (start_thickness + end_thickness) / 2,
            "node_id": node.root_id,
            "depth": node.depth,
            "start_thickness": start_thickness,
            "end_thickness": end_thickness,
            "is_terminal": is_terminal,
            "descendants": 0,  # will be filled later
            "mastery_score": round(mastery, 4),
        })

    # Fill descendants: count terminal branches with same root_id
    root_terminal_counts: Dict[str, int] = {}
    for b in branches:
        if b["is_terminal"]:
            root_terminal_counts[b["node_id"]] = root_terminal_counts.get(b["node_id"], 0) + 1

    for b in branches:
        b["descendants"] = root_terminal_counts.get(b["node_id"], 0)

    return branches


# ---------------------------------------------------------------------------
# Step 8: Root generation
# ---------------------------------------------------------------------------

def _generate_roots(
    trunk_base: Tuple[float, float],
    trunk_base_thickness: float,
    total_nodes: int,
    user_uuid_seed: int,
) -> Tuple[List[Dict], List[Tuple[float, float]]]:
    rng = random.Random(user_uuid_seed)

    if total_nodes < 30:
        n_roots = 3
    elif total_nodes < 100:
        n_roots = 4
    else:
        n_roots = 5

    root_branches: List[Dict] = []
    root_tip_positions: List[Tuple[float, float]] = []

    # Angular offset seeded by UUID
    base_angle_offset = rng.uniform(0, 2 * math.pi / n_roots)

    for i in range(n_roots):
        angle = base_angle_offset + (2 * math.pi * i / n_roots)
        # Add asymmetry
        angle += rng.uniform(-0.3, 0.3)

        # Root extends outward then downward
        horizontal_dist = 15 + trunk_base_thickness * 0.8
        vertical_drop = 12 + trunk_base_thickness * 0.4

        end_x = trunk_base[0] + horizontal_dist * math.cos(angle)
        end_y = trunk_base[1] + vertical_drop  # below ground

        # Bezier: horizontal outward first, then curve downward
        rng.seed(user_uuid_seed + i * 31)
        cp1_x = trunk_base[0] + horizontal_dist * 0.6 * math.cos(angle) + rng.uniform(-2, 2)
        cp1_y = trunk_base[1] + vertical_drop * 0.1
        cp2_x = end_x + rng.uniform(-2, 2)
        cp2_y = trunk_base[1] + vertical_drop * 0.6

        start_thickness = trunk_base_thickness * 0.6
        end_thickness = trunk_base_thickness * 0.1

        root_branches.append({
            "start": list(trunk_base),
            "end": [end_x, end_y],
            "control1": [cp1_x, cp1_y],
            "control2": [cp2_x, cp2_y],
            "thickness": (start_thickness + end_thickness) / 2,
            "node_id": "__root__",
            "depth": -1,
            "start_thickness": start_thickness,
            "end_thickness": end_thickness,
        })

        root_tip_positions.append((end_x, end_y))

    return root_branches, root_tip_positions


# ---------------------------------------------------------------------------
# Step 9: Ground generation
# ---------------------------------------------------------------------------

def _generate_ground(
    canvas_w: int, canvas_h: int,
    ground_y: float,
    root_tip_positions: List[Tuple[float, float]],
    seed: int,
) -> List[List[float]]:
    rng = random.Random(seed)
    ground_points: List[List[float]] = []
    n_ground_pts = 40

    for i in range(n_ground_pts + 1):
        x = canvas_w * i / n_ground_pts
        bump = rng.uniform(-3, 3)
        ground_points.append([x, ground_y + bump])

    return ground_points


# ---------------------------------------------------------------------------
# Step 10: Trunk leader
# ---------------------------------------------------------------------------

def _generate_trunk_leader(
    trunk_top: Tuple[float, float],
    trunk_top_thickness: float,
    trunk_height: float,
    canvas_w: int,
    seed: int,
) -> List[Dict]:
    """Short continuation above the trunk top, getting very thin."""
    rng = random.Random(seed)
    leader_length = trunk_height * 0.12
    leader_top_y = trunk_top[1] - leader_length
    leader_top_thickness = trunk_top_thickness * 0.35

    segments = 3
    branches: List[Dict] = []
    for i in range(segments):
        t0 = i / segments
        t1 = (i + 1) / segments
        y0 = trunk_top[1] - leader_length * t0
        y1 = trunk_top[1] - leader_length * t1
        st = trunk_top_thickness - (trunk_top_thickness - leader_top_thickness) * t0
        et = trunk_top_thickness - (trunk_top_thickness - leader_top_thickness) * t1

        rng.seed(seed + i * 17)
        x_offset = rng.uniform(-1, 1)

        branches.append({
            "start": [trunk_top[0] + x_offset * t0, y0],
            "end": [trunk_top[0] + x_offset * t1, y1],
            "control1": [trunk_top[0] + x_offset * (t0 * 0.67 + t1 * 0.33), y0 + (y1 - y0) * 0.33],
            "control2": [trunk_top[0] + x_offset * (t0 * 0.33 + t1 * 0.67), y0 + (y1 - y0) * 0.67],
            "thickness": (st + et) / 2,
            "node_id": "__trunk__",
            "depth": -1,
            "start_thickness": st,
            "end_thickness": et,
        })

    return branches


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_tree_skeleton(
    tree_data: List[Dict],
    canvas_w: int = 512,
    canvas_h: int = 512,
) -> Dict:
    """
    Generate tree skeleton using Space Colonization algorithm.

    Input: list of node dicts with {id, name, depth, parent_id, child_count, mastery_score}
    Output: SkeletonData v2 dict
    """
    canvas_w = 512
    canvas_h = 512

    if not tree_data:
        return {
            "branches": [],
            "canvas_size": [canvas_w, canvas_h],
            "trunk": None,
            "ground": None,
            "roots": [],
            "crown_layers": [],
            "version": 2,
            "growth": None,
        }

    stats = _compute_tree_stats(tree_data)
    if stats is None:
        return {
            "branches": [],
            "canvas_size": [canvas_w, canvas_h],
            "trunk": None,
            "ground": None,
            "roots": [],
            "crown_layers": [],
            "version": 2,
            "growth": None,
        }

    (children_map, parent_map, root_stats,
     total_nodes, global_max_depth,
     width_depth_ratio, max_subtree_ratio, health) = stats

    n_roots = len(root_stats)
    seed = _uuid_seed([rs["id"] for rs in root_stats])
    growth_multiplier = health["growth_multiplier"]

    # --- Layout constants ---
    ground_y = canvas_h * 0.88

    # --- Step 1: Trunk ---
    trunk_result = _generate_trunk(canvas_w, canvas_h, ground_y, total_nodes, n_roots, seed, growth_multiplier)
    trunk_branches, trunk_base, trunk_top, trunk_base_thickness, trunk_top_thickness = trunk_result

    # --- Step 2: Crown outline ---
    crown = _generate_crown_outline(
        canvas_w, canvas_h, total_nodes,
        width_depth_ratio, max_subtree_ratio,
        trunk_top, seed + 1, growth_multiplier,
    )

    # --- Step 3: Attractors ---
    sectors = _distribute_attractors(crown, root_stats, total_nodes, seed + 2, growth_multiplier)

    # --- Step 4: Primary branches ---
    primary_result = _generate_primary_branches(
        trunk_base, trunk_top,
        trunk_base[1] - trunk_top[1],  # trunk_height
        trunk_base_thickness, trunk_top_thickness,
        root_stats, crown, sectors, seed + 3,
    )
    primary_branches, initial_sc_nodes, fork_points, _ = primary_result

    # --- Step 5: Space Colonization ---
    sc_nodes = _space_colonization(
        initial_sc_nodes, sectors, crown, seed + 4,
    )

    # --- Step 6: da Vinci thickness ---
    _compute_thicknesses(sc_nodes, trunk_base_thickness, trunk_top_thickness)

    # Build mastery lookup by root id
    mastery_by_root = {rs["id"]: rs["mastery_score"] for rs in root_stats}

    # --- Step 7: Convert to Bezier branches ---
    sc_branches = _nodes_to_bezier_branches(sc_nodes, seed + 5, mastery_by_root)

    # --- Trunk leader ---
    leader_branches = _generate_trunk_leader(trunk_top, trunk_top_thickness, trunk_base[1] - trunk_top[1], canvas_w, seed + 6)
    trunk_branches.extend(leader_branches)

    # --- Step 8: Roots ---
    root_branches, root_tip_positions = _generate_roots(
        trunk_base, trunk_base_thickness, total_nodes, seed + 7,
    )

    # --- Step 9: Ground ---
    ground_points = _generate_ground(canvas_w, canvas_h, ground_y, root_tip_positions, seed + 8)

    # --- Root bulges ---
    root_bulges = [
        {"position": list(pos), "radius": trunk_base_thickness * 0.5}
        for pos in root_tip_positions
    ]

    # --- Combine all branches ---
    all_branches = primary_branches + sc_branches

    print(f"[generate_tree_skeleton] roots={n_roots}, total_nodes={total_nodes}, "
          f"sc_nodes={len(sc_nodes)}, branches={len(all_branches)}, "
          f"crown=({crown.semi_axis_x:.0f}x{crown.semi_axis_y:.0f} n={crown.superellipse_n:.1f})"
          f" health={health}")

    return {
        "branches": all_branches,
        "canvas_size": [canvas_w, canvas_h],
        "trunk": trunk_branches,
        "ground": ground_points,
        "roots": root_branches,
        "crown_layers": [],  # v1 compat
        "version": 2,
        "fork_points": [
            {"position": list(fp.position), "radius": fp.radius, "is_primary": fp.is_primary, "root_id": fp.root_id}
            for fp in fork_points
        ],
        "crown_outline": {
            "center": [crown.center_x, crown.center_y],
            "semi_axis_x": crown.semi_axis_x,
            "semi_axis_y": crown.semi_axis_y,
            "eccentricity_x": crown.eccentricity_x,
            "superellipse_n": crown.superellipse_n,
            "points": [list(p) for p in crown.points],
        },
        "root_bulges": root_bulges,
        "growth": health,
    }
