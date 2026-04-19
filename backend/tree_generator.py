"""
L-system based tree skeleton generator for knowledge tree visualization.
"""
import math
import random
from io import BytesIO
from typing import List, Dict, Tuple
from datetime import datetime
from os import getenv

from PIL import Image, ImageDraw
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# Initialize Supabase client with service role key (bypasses RLS)
# Use placeholder values if env vars not set (for testing)
supabase: Client = create_client(
    getenv("SUPABASE_URL") or "https://placeholder.supabase.co",
    getenv("SUPABASE_SERVICE_KEY") or "placeholder-key"
)


def fetch_user_tree(user_id: str) -> List[Dict]:
    """
    Fetch complete tree data for a user from Supabase.

    Returns list of nodes with: id, name, depth, parent_id, child_count, mastery_score
    """
    # Fetch all nodes for user
    nodes_response = supabase.table("nodes").select(
        "id, name, content"
    ).eq("owner_id", user_id).eq("is_deleted", False).execute()

    nodes = nodes_response.data
    if not nodes:
        return []

    node_ids = [n["id"] for n in nodes]

    # Fetch all edges (both parent and child relationships)
    edges_response = supabase.table("edges").select(
        "parent_id, child_id, sort_order"
    ).or_(f"parent_id.in.({','.join(node_ids)}),child_id.in.({','.join(node_ids)})").execute()

    edges = edges_response.data

    # Build parent and child maps
    parent_map = {}  # child_id -> parent_id
    child_count_map = {}  # parent_id -> count

    for edge in edges:
        parent_id = edge["parent_id"]
        child_id = edge["child_id"]

        if child_id in node_ids:
            parent_map[child_id] = parent_id

        if parent_id and parent_id in node_ids:
            child_count_map[parent_id] = child_count_map.get(parent_id, 0) + 1

    # Calculate depth for each node recursively
    def calculate_depth(node_id: str, visited: set) -> int:
        if node_id in visited:
            return 0  # Cycle detection
        if node_id not in parent_map:
            return 0  # Root node

        visited.add(node_id)
        parent_id = parent_map[node_id]
        if parent_id not in node_ids:
            return 0  # Parent outside user's tree

        return 1 + calculate_depth(parent_id, visited)

    # Construct tree data
    tree_data = []
    for node in nodes:
        node_id = node["id"]
        depth = calculate_depth(node_id, set())

        tree_data.append({
            "id": node_id,
            "name": node["name"],
            "depth": depth,
            "parent_id": parent_map.get(node_id),
            "child_count": child_count_map.get(node_id, 0),
            "mastery_score": 0.5  # Placeholder
        })

    # --- Debug logging ---
    print(f"[fetch_user_tree] user_id={user_id}, nodes_fetched={len(nodes)}, edges_fetched={len(edges)}")
    for n in tree_data:
        print(f"  node id={n['id'][:8]}... name={n['name']!r} depth={n['depth']} parent_id={str(n['parent_id'])[:8] if n['parent_id'] else None}... child_count={n['child_count']}")

    return tree_data


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


def generate_lsystem_skeleton(tree_data: List[Dict]) -> Dict:
    """
    Generate visually appealing tree skeleton driven by data statistics.

    Design logic:
    - Root node count → number of main branches from trunk top
    - Each root's descendant count → that branch's thickness + L-system iterations
    - Max tree depth → overall tree height
    - Branches carry root's node_id (clickable to identify which knowledge root)
    """
    if not tree_data:
        return {"branches": [], "canvas_size": [512, 512], "trunk": None, "ground": None, "roots": []}

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
        return {"branches": [], "canvas_size": [512, 512], "trunk": None, "ground": None, "roots": []}

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
    canvas_w, canvas_h = 512, 512
    ground_y = canvas_h * 0.88
    trunk_base = (canvas_w / 2, ground_y)
    trunk_height = canvas_h * 0.30
    trunk_top = (canvas_w / 2, ground_y - trunk_height)

    # --- Trunk: tapered from 20 (base) to 10 (top) ---
    trunk_branches: List[Dict] = []
    trunk_segments = 8
    for i in range(trunk_segments):
        t0 = i / trunk_segments
        t1 = (i + 1) / trunk_segments
        y0 = trunk_base[1] - trunk_height * t0
        y1 = trunk_base[1] - trunk_height * t1
        thickness = 20 - (20 - 10) * ((t0 + t1) / 2)
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

    # --- Generate L-system branches for each root ---
    all_branches: List[Dict] = []

    # Height for canopy: proportional to max_depth, leaves room for trunk
    # More depth → taller canopy, clamped to reasonable range
    canopy_height = canvas_h * min(0.55, 0.25 + global_max_depth * 0.06)

    # Max descendants across roots, used for relative scaling
    max_desc = max(rs["descendants"] for rs in root_stats) if root_stats else 1

    # Angle spread for main branches: ±45° total
    n_roots_actual = len(roots)
    if n_roots_actual == 1:
        main_angles = [90.0]
    else:
        angle_span = min(90, 30 + n_roots_actual * 12)
        main_angles = [
            90 + (i - (n_roots_actual - 1) / 2) * (angle_span / (n_roots_actual - 1))
            for i in range(n_roots_actual)
        ]

    for idx, rs in enumerate(root_stats):
        root_id = rs["id"]
        descendants = rs["descendants"]

        # Thickness: root with more descendants is thicker (6-14)
        rel = descendants / max(max_desc, 1)
        base_thickness = 6 + rel * 8

        # Iterations: more descendants → more iterations → denser foliage (2-5)
        iterations = min(5, max(2, 1 + descendants // 3))

        # Branch rule: 2-3 sub-branches per F for a natural look
        if descendants == 0:
            rule = "F"
        elif descendants <= 2:
            rule = "F[+F][-F]"
        elif descendants <= 5:
            rule = "FF[+F][-F]"
        else:
            rule = "FF[+F][-F][+F]"

        # Generate L-system string
        lstring = lsystem_iterate("F", rule, iterations)

        # Initial segment length based on canopy height and depth
        initial_length = canopy_height / (iterations + 1)

        # Angle delta: slightly wider for sparser trees, tighter for dense ones
        angle_delta = max(18, 30 - iterations * 2)

        # Interpret into branches, with boundary-check retry
        base_angle = main_angles[idx]
        seed = hash(root_id) % (2**32)

        # Per-root angular perturbation
        random.seed(seed)
        perturbation = random.uniform(-3, 3)
        start_angle = base_angle + perturbation

        print(f"  root {rs['name']!r}: base_angle={base_angle:.1f}° perturbation={perturbation:.1f}° start_angle={start_angle:.1f}° iterations={iterations} rule={rule!r}")

        # Try generating with boundary check; retry with angle clamped toward 90°
        branches: List[Dict] = []
        max_retries = 5
        for attempt in range(max_retries):
            candidate = interpret_lsystem(
                lstring=lstring,
                start_pos=trunk_top,
                start_angle=start_angle,
                initial_length=initial_length,
                base_angle_delta=angle_delta,
                node_id=root_id,
                depth=0,
            )

            # Boundary check: any start/end outside [0, canvas_w] x [0, canvas_h]?
            out_of_bounds = False
            for b in candidate:
                for coord in [b["start"], b["end"]]:
                    if coord[0] < 0 or coord[0] > canvas_w or coord[1] < 0 or coord[1] > canvas_h:
                        out_of_bounds = True
                        break
                if out_of_bounds:
                    break

            if not out_of_bounds:
                branches = candidate
                break

            # Clamp angle toward 90° (straight up) and retry
            print(f"    attempt {attempt+1} out-of-bounds at start_angle={start_angle:.1f}°, clamping toward 90°")
            start_angle = 90 + (start_angle - 90) * 0.5

        if out_of_bounds:
            print(f"    WARNING: root {rs['name']!r} still out-of-bounds after {max_retries} retries, discarding")
            continue

        # Override thickness: base_thickness at depth 0, taper with depth
        for b in branches:
            b["thickness"] = max(1, base_thickness * (0.7 ** b["depth"]))
            b["node_id"] = root_id
            b["descendants"] = descendants

        all_branches.extend(branches)

    print(f"[generate_lsystem_skeleton] generated {len(all_branches)} branches from {total_nodes} nodes ({n_roots_actual} roots)")

    return {
        "branches": all_branches,
        "canvas_size": [canvas_w, canvas_h],
        "trunk": trunk_branches,
        "ground": ground_points,
        "roots": roots_data,
    }


def render_skeleton_png(skeleton_data: Dict) -> BytesIO:
    """
    Render skeleton data to PNG image using bezier curves.

    Returns BytesIO object containing PNG data.
    """
    width, height = skeleton_data["canvas_size"]

    # Create white canvas
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    # Draw branches as bezier curves
    for branch in skeleton_data["branches"]:
        start = branch["start"]
        end = branch["end"]
        cp1 = branch["control1"]
        cp2 = branch["control2"]
        thickness = int(branch["thickness"])

        # Sample bezier curve into line segments
        points = []
        steps = 20  # Number of segments for smooth curve
        for i in range(steps + 1):
            t = i / steps
            # Cubic bezier formula: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
            x = (
                (1 - t) ** 3 * start[0] +
                3 * (1 - t) ** 2 * t * cp1[0] +
                3 * (1 - t) * t ** 2 * cp2[0] +
                t ** 3 * end[0]
            )
            y = (
                (1 - t) ** 3 * start[1] +
                3 * (1 - t) ** 2 * t * cp1[1] +
                3 * (1 - t) * t ** 2 * cp2[1] +
                t ** 3 * end[1]
            )
            points.append((x, y))

        # Draw the curve as connected line segments
        if len(points) > 1:
            draw.line(points, fill="black", width=thickness, joint="curve")

    # Save to BytesIO
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return buffer


def save_skeleton(user_id: str, skeleton_data: Dict, png_bytes: BytesIO) -> str:
    """
    Save skeleton data and PNG to Supabase.

    Returns public URL of the PNG.
    """
    # Generate unique filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{user_id}/{timestamp}.png"

    # Upload PNG to Storage
    storage_response = supabase.storage.from_("tree-assets").upload(
        filename,
        png_bytes.getvalue(),
        {"content-type": "image/png"}
    )

    # Get public URL
    png_url = supabase.storage.from_("tree-assets").get_public_url(filename)

    # Insert skeleton data into database
    supabase.table("tree_skeletons").insert({
        "owner_id": user_id,
        "skeleton_data": skeleton_data,
        "png_url": png_url
    }).execute()

    return png_url


def generate_tree_visualization(user_id: str) -> str:
    """
    Main function to generate tree visualization.

    Returns PNG URL.
    """
    # 1. Fetch tree data
    tree_data = fetch_user_tree(user_id)

    if not tree_data:
        raise ValueError(f"No tree data found for user {user_id}")

    # 2. Generate skeleton
    skeleton = generate_lsystem_skeleton(tree_data)

    # 3. Render PNG
    png_bytes = render_skeleton_png(skeleton)

    # 4. Save to Supabase
    png_url = save_skeleton(user_id, skeleton, png_bytes)

    return png_url
