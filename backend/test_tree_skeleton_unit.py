"""
Unit tests for tree_skeleton.py (Space Colonization generator).
"""
import math
import pytest
from tree_skeleton import (
    generate_tree_skeleton,
    _compute_tree_stats,
    _generate_crown_outline,
    _distribute_attractors,
    _space_colonization,
    _point_in_superellipse,
    _project_onto_superellipse,
    _nodes_to_bezier_branches,
    _count_descendants,
    _max_depth,
    BranchNode,
    CrownOutline,
    Sector,
)


# --- Fixtures ---

def _make_tree(n_roots=3, depth=2, children_per_node=2, mastery=0.5):
    """Generate a test tree with specified structure."""
    nodes = []
    node_id = 0

    for r in range(n_roots):
        rid = f"root_{r}"
        nodes.append({
            "id": rid, "name": f"Root{r}",
            "depth": 0, "parent_id": None,
            "child_count": children_per_node,
            "mastery_score": mastery + r * 0.1,
        })

        def _add_children(parent_id, current_depth):
            nonlocal node_id
            if current_depth >= depth:
                return
            for c in range(children_per_node):
                cid = f"node_{node_id}"
                node_id += 1
                child_count = children_per_node if current_depth < depth - 1 else 0
                nodes.append({
                    "id": cid, "name": f"Node{cid}",
                    "depth": current_depth + 1, "parent_id": parent_id,
                    "child_count": child_count,
                    "mastery_score": mastery * 0.8,
                })
                _add_children(cid, current_depth + 1)

        _add_children(rid, 0)

    return nodes


SAMPLE_TREE = _make_tree(3, 2, 2, 0.5)


# --- Determinism ---

class TestDeterminism:
    def test_same_input_same_output(self):
        r1 = generate_tree_skeleton(SAMPLE_TREE)
        r2 = generate_tree_skeleton(SAMPLE_TREE)
        assert r1["branches"] == r2["branches"]
        assert r1["crown_outline"] == r2["crown_outline"]

    def test_different_ids_different_trees(self):
        tree_a = [dict(n, id=n["id"] + "_a") for n in SAMPLE_TREE]
        # Fix parent_ids too
        for n in tree_a:
            if n["parent_id"]:
                n["parent_id"] += "_a"
        tree_b = [dict(n, id=n["id"] + "_b") for n in SAMPLE_TREE]
        for n in tree_b:
            if n["parent_id"]:
                n["parent_id"] += "_b"
        sk_a = generate_tree_skeleton(tree_a)
        sk_b = generate_tree_skeleton(tree_b)
        assert sk_a["branches"] != sk_b["branches"]


# --- Tree statistics ---

class TestTreeStats:
    def test_empty_tree(self):
        result = _compute_tree_stats([])
        assert result is None

    def test_single_root(self):
        tree = [{"id": "r1", "name": "R", "depth": 0, "parent_id": None, "child_count": 0, "mastery_score": 0.5}]
        stats = _compute_tree_stats(tree)
        assert stats is not None
        _, _, root_stats, total, max_depth, wdr, msr = stats
        assert total == 1
        assert max_depth == 0
        assert len(root_stats) == 1
        assert root_stats[0]["subtree_size"] == 1

    def test_multi_root(self):
        stats = _compute_tree_stats(SAMPLE_TREE)
        assert stats is not None
        _, _, root_stats, total, max_depth, wdr, msr = stats
        assert len(root_stats) == 3
        assert total == len(SAMPLE_TREE)
        assert max_depth > 0

    def test_width_depth_ratio(self):
        tree = [{"id": f"r{i}", "name": f"R{i}", "depth": 0, "parent_id": None, "child_count": 0, "mastery_score": 0.5} for i in range(5)]
        stats = _compute_tree_stats(tree)
        wdr = stats[5]
        assert wdr > 1.0  # 5 roots, depth 0 -> ratio = 5

    def test_max_subtree_ratio(self):
        # One big root, one tiny root
        tree = [{"id": "big", "name": "Big", "depth": 0, "parent_id": None, "child_count": 5, "mastery_score": 0.5}]
        for i in range(5):
            tree.append({"id": f"c{i}", "name": f"C{i}", "depth": 1, "parent_id": "big", "child_count": 0, "mastery_score": 0.5})
        tree.append({"id": "tiny", "name": "Tiny", "depth": 0, "parent_id": None, "child_count": 0, "mastery_score": 0.5})

        stats = _compute_tree_stats(tree)
        msr = stats[6]
        assert msr > 0.5  # big root has 6 nodes out of 7


# --- Superellipse ---

class TestSuperellipse:
    def test_point_inside(self):
        assert _point_in_superellipse(0, 0, 0, 0, 10, 10, 2)
        assert _point_in_superellipse(5, 0, 0, 0, 10, 10, 2)
        assert not _point_in_superellipse(15, 0, 0, 0, 10, 10, 2)

    def test_point_inside_high_n(self):
        # Superellipse with n=4: more rectangular
        assert _point_in_superellipse(8, 0, 0, 0, 10, 10, 4)
        assert not _point_in_superellipse(12, 0, 0, 0, 10, 10, 4)

    def test_project_onto_boundary(self):
        # Point outside should project to boundary
        px, py = _project_onto_superellipse(20, 0, 0, 0, 10, 10, 2)
        val = (px / 10) ** 2 + (py / 10) ** 2
        assert abs(val - 1.0) < 0.05  # Should be on or near boundary


# --- Crown outline ---

class TestCrownOutline:
    def test_flat_crown_for_wide_tree(self):
        crown = _generate_crown_outline(512, 512, 30, 2.5, 0.3, (256, 300), seed=42)
        assert crown.semi_axis_x >= crown.semi_axis_y

    def test_tall_crown_for_deep_tree(self):
        crown = _generate_crown_outline(512, 512, 30, 0.3, 1.0, (256, 300), seed=42)
        assert crown.semi_axis_y >= crown.semi_axis_x

    def test_eccentricity_for_dominant_root(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.8, (256, 300), seed=42)
        assert crown.eccentricity_x != 0.0

    def test_superellipse_n_wide(self):
        crown = _generate_crown_outline(512, 512, 30, 2.5, 0.3, (256, 300), seed=42)
        assert crown.superellipse_n > 2.0

    def test_superellipse_n_deep(self):
        crown = _generate_crown_outline(512, 512, 30, 0.3, 1.0, (256, 300), seed=42)
        assert crown.superellipse_n <= 2.0

    def test_points_generated(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        assert len(crown.points) == 64

    def test_area_scales_logarithmically(self):
        crown_small = _generate_crown_outline(512, 512, 5, 1.0, 0.3, (256, 300), seed=42)
        crown_big = _generate_crown_outline(512, 512, 100, 1.0, 0.3, (256, 300), seed=42)
        area_small = math.pi * crown_small.semi_axis_x * crown_small.semi_axis_y
        area_big = math.pi * crown_big.semi_axis_x * crown_big.semi_axis_y
        assert area_big > area_small
        # Logarithmic: 20x more nodes should not produce 20x area
        assert area_big / area_small < 5


# --- Attractor distribution ---

class TestAttractors:
    def test_sector_count_matches_roots(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [
            {"id": "r1", "name": "A", "subtree_size": 10, "mastery_score": 0.5},
            {"id": "r2", "name": "B", "subtree_size": 5, "mastery_score": 0.3},
        ]
        sectors = _distribute_attractors(crown, root_stats, 30, seed=42)
        assert len(sectors) == 2

    def test_all_attractors_inside_crown(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [
            {"id": "r1", "name": "A", "subtree_size": 15, "mastery_score": 0.5},
            {"id": "r2", "name": "B", "subtree_size": 10, "mastery_score": 0.3},
        ]
        sectors = _distribute_attractors(crown, root_stats, 30, seed=42)
        for sector in sectors:
            for pt in sector.attractor_points:
                assert _point_in_superellipse(
                    pt[0], pt[1],
                    crown.center_x, crown.center_y,
                    crown.semi_axis_x, crown.semi_axis_y,
                    crown.superellipse_n,
                ), f"Attractor {pt} outside crown"

    def test_larger_subtree_gets_more_attractors(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [
            {"id": "r1", "name": "Big", "subtree_size": 20, "mastery_score": 0.5},
            {"id": "r2", "name": "Small", "subtree_size": 3, "mastery_score": 0.5},
        ]
        sectors = _distribute_attractors(crown, root_stats, 30, seed=42)
        assert len(sectors[0].attractor_points) > len(sectors[1].attractor_points)

    def test_mastery_affects_density(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats_low = [
            {"id": "r1", "name": "Low", "subtree_size": 10, "mastery_score": 0.1},
            {"id": "r2", "name": "High", "subtree_size": 10, "mastery_score": 0.9},
        ]
        sectors = _distribute_attractors(crown, root_stats_low, 30, seed=42)
        # High mastery should get more attractors
        assert len(sectors[1].attractor_points) >= len(sectors[0].attractor_points)


# --- Space Colonization ---

class TestSpaceColonization:
    def test_produces_branches(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [{"id": "r1", "name": "A", "subtree_size": 15, "mastery_score": 0.5}]
        sectors = _distribute_attractors(crown, root_stats, 30, seed=42)

        initial = [BranchNode(position=(256, 300), parent_index=None, root_id="r1", depth=1, thickness=0)]
        nodes = _space_colonization(initial, sectors, crown, seed=42, max_branches=100)
        assert len(nodes) > 1

    def test_branches_inside_crown(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [{"id": "r1", "name": "A", "subtree_size": 15, "mastery_score": 0.5}]
        sectors = _distribute_attractors(crown, root_stats, 30, seed=42)

        initial = [BranchNode(position=(256, 300), parent_index=None, root_id="r1", depth=1, thickness=0)]
        nodes = _space_colonization(initial, sectors, crown, seed=42, max_branches=100)

        for node in nodes:
            # Allow small margin for boundary projection
            inside = _point_in_superellipse(
                node.position[0], node.position[1],
                crown.center_x, crown.center_y,
                crown.semi_axis_x * 1.05, crown.semi_axis_y * 1.05,
                crown.superellipse_n,
            )
            assert inside, f"Node at {node.position} outside crown"

    def test_respects_max_branches(self):
        crown = _generate_crown_outline(512, 512, 30, 1.0, 0.3, (256, 300), seed=42)
        root_stats = [{"id": "r1", "name": "A", "subtree_size": 15, "mastery_score": 0.5}]
        sectors = _distribute_attractors(crown, root_stats, 100, seed=42)

        initial = [BranchNode(position=(256, 300), parent_index=None, root_id="r1", depth=1, thickness=0)]
        nodes = _space_colonization(initial, sectors, crown, seed=42, max_branches=50)
        assert len(nodes) <= 50


# --- da Vinci model ---

class TestDaVinci:
    def test_thickness_assigned(self):
        nodes = [
            BranchNode(position=(0, 0), parent_index=None, root_id="r1", depth=0, thickness=0,
                       children_indices=[1, 2]),
            BranchNode(position=(10, 10), parent_index=0, root_id="r1", depth=1, thickness=0,
                       children_indices=[]),
            BranchNode(position=(10, -10), parent_index=0, root_id="r1", depth=1, thickness=0,
                       children_indices=[]),
        ]
        from tree_skeleton import _compute_thicknesses
        _compute_thicknesses(nodes, 10, 4)
        for node in nodes:
            assert node.thickness > 0
        # Root should be thicker than leaves
        assert nodes[0].thickness >= nodes[1].thickness


# --- Full pipeline ---

class TestFullPipeline:
    def test_empty_input(self):
        result = generate_tree_skeleton([])
        assert result["branches"] == []
        assert result["version"] == 2

    def test_output_has_v1_fields(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        assert "branches" in result
        assert "canvas_size" in result
        assert "trunk" in result
        assert "ground" in result
        assert "roots" in result

    def test_output_has_v2_fields(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        assert result.get("version") == 2
        assert "fork_points" in result
        assert "crown_outline" in result
        assert "root_bulges" in result

    def test_branch_has_taper_fields(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        for branch in result["branches"]:
            assert "start_thickness" in branch
            assert "end_thickness" in branch
            assert "is_terminal" in branch

    def test_branch_node_ids_diverse(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        node_ids = set(b["node_id"] for b in result["branches"])
        # Should have multiple distinct node_ids (one per root)
        assert len(node_ids) > 1

    def test_trunk_has_taper(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        if result["trunk"]:
            for seg in result["trunk"]:
                assert "start_thickness" in seg
                assert "end_thickness" in seg
                # Trunk should taper: start > end
                assert seg["start_thickness"] >= seg["end_thickness"]

    def test_roots_have_taper(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        if result["roots"]:
            for root in result["roots"]:
                assert "start_thickness" in root
                assert "end_thickness" in root
                assert root["start_thickness"] > root["end_thickness"]

    def test_crown_outline_valid(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        outline = result["crown_outline"]
        assert outline["semi_axis_x"] > 0
        assert outline["semi_axis_y"] > 0
        assert 2.0 <= outline["superellipse_n"] <= 4.0
        assert len(outline["points"]) == 64

    def test_fork_points_present(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        assert len(result["fork_points"]) == len(SAMPLE_TREE) - sum(
            1 for n in SAMPLE_TREE if n["parent_id"] is not None
        ) or len(result["fork_points"]) > 0

    def test_canvas_size(self):
        result = generate_tree_skeleton(SAMPLE_TREE)
        assert result["canvas_size"] == [512, 512]
