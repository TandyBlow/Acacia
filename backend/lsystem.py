"""
L-system core algorithms for tree skeleton generation.
Pure functions with no I/O or external dependencies.
"""
import math
import random
from typing import List, Dict, Tuple


def generate_lsystem_rule(child_count: int) -> str:
    """
    Generate L-system rule based on child count.

    - child_count = 0 (leaf): F -> F
    - child_count = 1: F -> F[+F]
    - child_count = 2: F -> F[+F][-F]
    - child_count = 3: F -> F[+F][F][-F]
    - child_count = n: F -> F + n branches evenly distributed
    """
    if child_count == 0:
        return "F"
    elif child_count == 1:
        return "F[+F]"
    elif child_count == 2:
        return "F[+F][-F]"
    elif child_count == 3:
        return "F[+F][F][-F]"
    else:
        # Generate n branches evenly distributed
        branches = []
        for i in range(child_count):
            # Distribute angles evenly across ±25° range
            angle_offset = (i - (child_count - 1) / 2) * (50 / max(child_count - 1, 1))
            if angle_offset > 0:
                branches.append(f"[+F]")
            elif angle_offset < 0:
                branches.append(f"[-F]")
            else:
                branches.append(f"[F]")
        return "F" + "".join(branches)


def lsystem_iterate(axiom: str, rule: str, iterations: int) -> str:
    """
    Iterate L-system string replacement.
    """
    current = axiom
    for _ in range(iterations):
        current = current.replace("F", rule)
    return current


def interpret_lsystem(
    lstring: str,
    start_pos: Tuple[float, float],
    start_angle: float,
    initial_length: float,
    base_angle_delta: float,
    node_id: str,
    depth: int
) -> List[Dict]:
    """
    Interpret L-system string into branch coordinates.

    Length decays at branch points `[`, not per segment `F`.
    This prevents exponential decay on consecutive F's (e.g. rule prefix "FF").
    """
    MAX_BRANCHES = 500

    stack = []
    pos = start_pos
    angle = start_angle
    length = initial_length
    branches: List[Dict] = []
    branch_index = 0

    seed = hash(node_id) % (2**32)

    for char in lstring:
        if len(branches) >= MAX_BRANCHES:
            break

        if char == 'F':
            new_x = pos[0] + length * math.cos(math.radians(angle))
            new_y = pos[1] - length * math.sin(math.radians(angle))
            new_pos = (new_x, new_y)

            dx = new_x - pos[0]
            dy = new_y - pos[1]
            seg_len = math.hypot(dx, dy)

            # Skip zero-length or near-zero branches
            if seg_len < 1:
                pos = new_pos
                branch_index += 1
                continue

            random.seed(seed + branch_index)

            max_offset = seg_len * 0.30

            t1 = 0.33
            cp1_x = pos[0] + dx * t1
            cp1_y = pos[1] + dy * t1
            perp_angle = angle + 90
            offset1 = random.uniform(-length * 0.15, length * 0.15)
            offset1 = max(-max_offset, min(max_offset, offset1))
            cp1_x += offset1 * math.cos(math.radians(perp_angle))
            cp1_y -= offset1 * math.sin(math.radians(perp_angle))

            t2 = 0.67
            cp2_x = pos[0] + dx * t2
            cp2_y = pos[1] + dy * t2
            offset2 = random.uniform(-length * 0.15, length * 0.15)
            offset2 = max(-max_offset, min(max_offset, offset2))
            cp2_x += offset2 * math.cos(math.radians(perp_angle))
            cp2_y -= offset2 * math.sin(math.radians(perp_angle))

            # Thickness based on stack depth (branch level)
            branch_depth = len(stack)
            thickness = max(1, 8 - branch_depth)

            branches.append({
                "start": list(pos),
                "end": list(new_pos),
                "control1": [cp1_x, cp1_y],
                "control2": [cp2_x, cp2_y],
                "thickness": thickness,
                "node_id": node_id,
                "depth": branch_depth,
            })

            pos = new_pos
            # NO length decay here — same-level segments keep their length

        elif char == '+':
            random.seed(seed + branch_index)
            perturbation = random.uniform(-5, 5)
            angle -= (base_angle_delta + perturbation)
            branch_index += 1

        elif char == '-':
            random.seed(seed + branch_index)
            perturbation = random.uniform(-5, 5)
            angle += (base_angle_delta + perturbation)
            branch_index += 1

        elif char == '[':
            # Save current state, then reduce length for the new branch
            stack.append((pos, angle, length))
            length *= 0.7

        elif char == ']':
            # Restore state (length is restored to pre-branch value)
            if stack:
                pos, angle, length = stack.pop()

    return branches


def _count_descendants(node_id: str, children_map: Dict[str, List[str]]) -> int:
    """Count total descendants of a node (not including itself)."""
    count = 0
    for cid in children_map.get(node_id, []):
        count += 1 + _count_descendants(cid, children_map)
    return count


def _max_depth(node_id: str, children_map: Dict[str, List[str]], current: int = 0) -> int:
    """Get max depth below a node (0 if leaf)."""
    children = children_map.get(node_id, [])
    if not children:
        return current
    return max(_max_depth(cid, children_map, current + 1) for cid in children)


def generate_lsystem_skeleton(tree_data: List[Dict], _canvas_w: int = 512, _canvas_h: int = 512) -> Dict:
    """
    Generate visually appealing tree skeleton driven by data statistics.

    Design logic:
    - Root node count → number of main branches from trunk top
    - Each root's descendant count → that branch's thickness + L-system iterations
    - Max tree depth → overall tree height
    - Branches carry root's node_id (clickable to identify which knowledge root)
    """
    # Fixed 512x512 — tree structure depends on data, not viewport size
    canvas_w = 512
    canvas_h = 512

    if not tree_data:
        return {"branches": [], "canvas_size": [canvas_w, canvas_h], "trunk": None, "ground": None, "roots": [], "crown_layers": []}

    # Build adjacency from tree_data
    parent_map: Dict[str, str | None] = {}
    children_map: Dict[str, List[str]] = {}
    node_by_id: Dict[str, Dict] = {n["id"]: n for n in tree_data}

    for node in tree_data:
        pid = node.get("parent_id")
        parent_map[node["id"]] = pid
        if pid:
            children_map.setdefault(pid, []).append(node["id"])

    # Find roots
    roots = [n for n in tree_data if n["parent_id"] is None]
    if not roots:
        roots = [n for n in tree_data if n["depth"] == 0]
    if not roots:
        return {"branches": [], "canvas_size": [canvas_w, canvas_h], "trunk": None, "ground": None, "roots": [], "crown_layers": []}

    # --- Compute statistics per root ---
    root_stats: List[Dict] = []
    global_max_depth = 0

    for root in roots:
        desc = _count_descendants(root["id"], children_map)
        depth = _max_depth(root["id"], children_map)
        global_max_depth = max(global_max_depth, depth)
        root_stats.append({
            "id": root["id"],
            "name": root["name"],
            "descendants": desc,
            "depth": depth,
        })

    total_nodes = len(tree_data)

    print(f"[generate_lsystem_skeleton] roots={len(roots)}, total_nodes={total_nodes}, max_depth={global_max_depth}")
    for rs in root_stats:
        print(f"  root {rs['name']!r}: descendants={rs['descendants']}, depth={rs['depth']}")

    # --- Canvas & layout ---
    ground_y = canvas_h * 0.88
    trunk_base = (canvas_w / 2, ground_y)

    n_roots_actual = len(roots)

    # Trunk height: scales with max_depth and total_nodes
    depth_factor = min(1.0, 0.4 + global_max_depth * 0.08)
    node_factor = min(1.0, 0.5 + math.log2(max(total_nodes, 2)) * 0.08)
    trunk_height = canvas_h * 0.20 * depth_factor * node_factor + canvas_h * 0.15
    trunk_top = (canvas_w / 2, ground_y - trunk_height)

    # Trunk thickness: scales with root count and total_nodes
    root_factor = min(1.0, 0.5 + n_roots_actual * 0.1)
    node_thick_factor = min(1.0, 0.6 + math.log2(max(total_nodes, 2)) * 0.07)
    trunk_base_thickness = 10 + 15 * root_factor * node_thick_factor
    trunk_top_thickness = trunk_base_thickness * 0.45

    # --- Trunk: tapered ---
    trunk_branches: List[Dict] = []
    trunk_segments = 8
    for i in range(trunk_segments):
        t0 = i / trunk_segments
        t1 = (i + 1) / trunk_segments
        y0 = trunk_base[1] - trunk_height * t0
        y1 = trunk_base[1] - trunk_height * t1
        thickness = trunk_base_thickness - (trunk_base_thickness - trunk_top_thickness) * ((t0 + t1) / 2)
        trunk_branches.append({
            "start": [trunk_base[0], y0],
            "end": [trunk_base[0], y1],
            "control1": [trunk_base[0], y0 + (y1 - y0) * 0.33],
            "control2": [trunk_base[0], y0 + (y1 - y0) * 0.67],
            "thickness": thickness,
            "node_id": "__trunk__",
            "depth": -1,
        })

    # --- Trunk leader: continuation above the top branch layer ---
    # The trunk doesn't stop at the top branch — it keeps going up, getting thinner
    leader_length = canvas_h * 0.08
    leader_base_y = trunk_base[1] - trunk_height
    leader_top_y = leader_base_y - leader_length
    leader_base_thickness = trunk_top_thickness
    leader_top_thickness = leader_base_thickness * 0.4
    leader_segments = 4
    for i in range(leader_segments):
        t0 = i / leader_segments
        t1 = (i + 1) / leader_segments
        y0 = leader_base_y - leader_length * t0
        y1 = leader_base_y - leader_length * t1
        thickness = leader_base_thickness - (leader_base_thickness - leader_top_thickness) * ((t0 + t1) / 2)
        trunk_branches.append({
            "start": [trunk_base[0], y0],
            "end": [trunk_base[0], y1],
            "control1": [trunk_base[0], y0 + (y1 - y0) * 0.33],
            "control2": [trunk_base[0], y0 + (y1 - y0) * 0.67],
            "thickness": thickness,
            "node_id": "__trunk__",
            "depth": -1,
        })

    # --- Ground ---
    random.seed(42)
    ground_points: List[List[float]] = []
    n_ground_pts = 40
    for i in range(n_ground_pts + 1):
        x = canvas_w * i / n_ground_pts
        bump = random.uniform(-3, 3)
        ground_points.append([x, ground_y + bump])

    # --- Roots ---
    n_roots = min(4, max(2, total_nodes // 5))
    roots_data: List[Dict] = []
    for i in range(n_roots):
        side = 1 if i % 2 == 0 else -1
        order = (i // 2) + 1
        angle = 90 - side * (15 + order * 12)
        length = 20 + order * 8
        end_x = trunk_base[0] + length * math.cos(math.radians(angle))
        end_y = trunk_base[1] + length * math.sin(math.radians(angle)) * 0.3
        thickness = max(2, 8 - order * 2)
        root_seed = hash(f"__root_{i}__") % (2**32)
        random.seed(root_seed)
        cp1_x = trunk_base[0] + (end_x - trunk_base[0]) * 0.33
        cp1_y = trunk_base[1] + (end_y - trunk_base[1]) * 0.33 + random.uniform(-2, 2)
        cp2_x = trunk_base[0] + (end_x - trunk_base[0]) * 0.67
        cp2_y = trunk_base[1] + (end_y - trunk_base[1]) * 0.67 + random.uniform(-2, 2)
        roots_data.append({
            "start": list(trunk_base),
            "end": [end_x, end_y],
            "control1": [cp1_x, cp1_y],
            "control2": [cp2_x, cp2_y],
            "thickness": thickness,
            "node_id": "__root__",
            "depth": -1,
        })

    # --- Multi-layer canopy ---
    all_branches: List[Dict] = []
    crown_layers: List[Dict] = []

    canopy_height = canvas_h * min(0.55, 0.25 + global_max_depth * 0.06)

    # Layer count and branches per layer driven by total_nodes only
    if total_nodes <= 3:
        n_layers = 1
        branches_per_layer = [2]
    elif total_nodes <= 8:
        n_layers = 2
        branches_per_layer = [2, 2]
    elif total_nodes <= 20:
        n_layers = 2
        branches_per_layer = [3, 3]
    elif total_nodes <= 40:
        n_layers = 3
        branches_per_layer = [2, 3, 3]
    else:
        n_layers = 3
        branches_per_layer = [3, 4, 4]

    base_thickness = 4 + min(8, total_nodes * 0.15)
    # Base branch length for the lowest layer; upper layers get shorter
    base_branch_length = canvas_w * min(0.18, 0.08 + math.log2(max(total_nodes, 2)) * 0.02)

    for layer_idx in range(n_layers):
        n_in_layer = branches_per_layer[layer_idx]

        # Layer emergence point along the trunk
        # Layer 0 (lowest) → 35% up trunk, layer N-1 (highest) → 80% up trunk
        layer_frac = (layer_idx + 0.5) / n_layers
        trunk_frac = 0.35 + layer_frac * 0.45
        emergence_y = trunk_base[1] - trunk_height * trunk_frac
        emergence_pos = (canvas_w / 2, emergence_y)

        # Upper layers get shorter, thinner branches
        layer_length = base_branch_length * (1.0 - layer_idx * 0.20)
        layer_thickness = base_thickness * (1.0 - layer_idx * 0.15)

        # Symmetric base angles: lower layers spread more, upper layers steeper
        # layer_idx 0 (bottom): ~40°/140°, layer N-1 (top): ~65°/115°
        right_count = (n_in_layer + 1) // 2
        left_count = n_in_layer // 2
        base_right = 50.0 + layer_idx * 10.0  # 50, 60, 70
        base_left = 130.0 - layer_idx * 10.0   # 130, 120, 110
        layer_angles = []
        for i in range(n_in_layer):
            is_right = i % 2 == 0
            if is_right:
                idx = i // 2
                base = base_right + idx * (8.0 / max(right_count, 1))
            else:
                idx = i // 2
                base = base_left - idx * (8.0 / max(left_count, 1))
            layer_angles.append(base)

        iterations = 2
        rule = "F[+F][-F]"

        lstring = lsystem_iterate("F", rule, iterations)
        initial_length = layer_length * 0.5
        angle_delta = max(15, 25 - iterations * 2)

        for li in range(n_in_layer):
            base_angle = layer_angles[li]
            seed = hash(f"branch_L{layer_idx}_{li}") % (2**32)

            random.seed(seed)
            # Random perturbation: angle ±8°, length ±20%
            angle_perturbation = random.uniform(-8, 8)
            length_multiplier = 0.8 + random.random() * 0.4  # 0.8 to 1.2
            start_angle = base_angle + angle_perturbation
            branch_initial_length = initial_length * length_multiplier

            print(f"  layer {layer_idx} branch {li}: emergence={trunk_frac:.2f} angle={base_angle:.1f}°+{angle_perturbation:.1f}° len_factor={length_multiplier:.2f} iterations={iterations}")

            branches: List[Dict] = []
            max_retries = 5
            out_of_bounds = False
            for attempt in range(max_retries):
                candidate = interpret_lsystem(
                    lstring=lstring,
                    start_pos=emergence_pos,
                    start_angle=start_angle,
                    initial_length=branch_initial_length,
                    base_angle_delta=angle_delta,
                    node_id=f"__layer{layer_idx}_branch{li}__",
                    depth=0,
                )

                out_of_bounds = False
                margin = canvas_w * 0.03
                for b in candidate:
                    for coord in [b["start"], b["end"]]:
                        if coord[0] < -margin or coord[0] > canvas_w + margin or coord[1] < -margin or coord[1] > canvas_h + margin:
                            out_of_bounds = True
                            break
                    if out_of_bounds:
                        break

                if not out_of_bounds:
                    branches = candidate
                    break

                print(f"    attempt {attempt+1} out-of-bounds, clamping toward 90°")
                start_angle = 90 + (start_angle - 90) * 0.5

            if out_of_bounds:
                print(f"    WARNING: branch {li} still OOB after {max_retries} retries, discarding")
                continue

            for b in branches:
                b["thickness"] = max(1, layer_thickness * (0.7 ** b["depth"]))
                b["node_id"] = roots[0]["id"] if roots else "__unknown__"
                b["descendants"] = total_nodes

            all_branches.extend(branches)

        # Compute crown layer geometry
        layer_start = len(all_branches) - len([b for b in all_branches if b.get("depth", -1) >= 0]) if not all_branches else 0
        layer_xs = [b["end"][0] for b in all_branches if b.get("depth", -1) >= 0]
        layer_ys = [b["end"][1] for b in all_branches if b.get("depth", -1) >= 0]

        if layer_xs and layer_ys:
            min_x, max_x = min(layer_xs), max(layer_xs)
            min_y, max_y = min(layer_ys), max(layer_ys)
            cx = (min_x + max_x) / 2
            cy = (min_y + max_y) / 2
            pad_x = (max_x - min_x) * 0.15 + canvas_w * 0.03
            pad_y = (max_y - min_y) * 0.15 + canvas_h * 0.02
            crown_layers.append({
                "center": [cx, cy],
                "width": (max_x - min_x) / 2 + pad_x,
                "height": (max_y - min_y) / 2 + pad_y,
            })

    print(f"[generate_lsystem_skeleton] generated {len(all_branches)} branches from {total_nodes} nodes ({n_roots_actual} roots)")

    # --- Apex fill: branches along the bare trunk leader ---
    # Find the actual highest canopy emergence point (where depth=0 branches start)
    canopy_start_ys = [b["start"][1] for b in all_branches if b.get("depth", -1) == 0]
    top_canopy_y = min(canopy_start_ys) if canopy_start_ys else trunk_base[1] - trunk_height * 0.80
    bare_top_y = leader_top_y  # top of the leader

    if top_canopy_y > bare_top_y:
        bare_length = top_canopy_y - bare_top_y
        # Place 3-5 pairs of branches along the bare section
        n_pairs = max(2, min(5, int(bare_length / 20)))
        fill_rule = "F[+F][-F]"
        fill_iterations = 2
        fill_lstring = lsystem_iterate("F", fill_rule, fill_iterations)

        for pair_idx in range(n_pairs):
            # Distribute evenly along the bare section, from bottom to top
            frac = (pair_idx + 1) / (n_pairs + 1)
            branch_y = top_canopy_y - bare_length * frac
            branch_pos = (canvas_w / 2, branch_y)

            # Branches get smaller and shorter toward the top
            size_decay = 1.0 - pair_idx * 0.15
            fill_len = base_branch_length * 0.30 * size_decay
            fill_thick = base_thickness * 0.35 * size_decay
            initial_len = fill_len * 0.5
            angle_delta = 30

            for side in [0, 1]:  # 0 = right, 1 = left
                seed = hash(f"__apex_{pair_idx}_{side}__") % (2**32)
                random.seed(seed)
                if side == 0:
                    base_angle = 55.0 + random.uniform(-10, 10)
                else:
                    base_angle = 125.0 + random.uniform(-10, 10)

                fill_branches = interpret_lsystem(
                    lstring=fill_lstring,
                    start_pos=branch_pos,
                    start_angle=base_angle,
                    initial_length=initial_len,
                    base_angle_delta=angle_delta,
                    node_id=f"__apex_{pair_idx}_{side}__",
                    depth=0,
                )

                # Check bounds
                margin = canvas_w * 0.03
                out_of_bounds = False
                for b in fill_branches:
                    for coord in [b["start"], b["end"]]:
                        if coord[0] < -margin or coord[0] > canvas_w + margin or coord[1] < -margin or coord[1] > canvas_h + margin:
                            out_of_bounds = True
                            break
                    if out_of_bounds:
                        break

                if not out_of_bounds and fill_branches:
                    for b in fill_branches:
                        b["thickness"] = max(1, fill_thick * (0.7 ** b["depth"]))
                        b["node_id"] = roots[0]["id"] if roots else "__unknown__"
                        b["descendants"] = total_nodes
                    all_branches.extend(fill_branches)
                    print(f"  apex pair {pair_idx} side {'R' if side == 0 else 'L'}: {len(fill_branches)} branches at y={branch_y:.0f}")

    return {
        "branches": all_branches,
        "canvas_size": [canvas_w, canvas_h],
        "trunk": trunk_branches,
        "ground": ground_points,
        "roots": roots_data,
        "crown_layers": crown_layers,
    }
