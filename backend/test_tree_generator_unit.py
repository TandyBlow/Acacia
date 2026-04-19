"""
Unit tests for tree_generator.py
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO
from tree_generator import (
    generate_lsystem_rule,
    lsystem_iterate,
    interpret_lsystem,
    generate_lsystem_skeleton,
    render_skeleton_png,
)


class TestLSystemRules:
    """Test L-system rule generation"""

    def test_leaf_node_rule(self):
        """Leaf nodes (child_count=0) should not branch"""
        rule = generate_lsystem_rule(0)
        assert rule == "F"

    def test_single_child_rule(self):
        """Single child should create one branch"""
        rule = generate_lsystem_rule(1)
        assert rule == "F[+F]"

    def test_two_children_rule(self):
        """Two children should create symmetric branches"""
        rule = generate_lsystem_rule(2)
        assert rule == "F[+F][-F]"

    def test_three_children_rule(self):
        """Three children should create left-center-right branches"""
        rule = generate_lsystem_rule(3)
        assert rule == "F[+F][F][-F]"

    def test_many_children_rule(self):
        """Many children should create evenly distributed branches"""
        rule = generate_lsystem_rule(5)
        assert rule.startswith("F")
        assert rule.count("[") == 5
        assert rule.count("]") == 5


class TestLSystemIteration:
    """Test L-system string iteration"""

    def test_single_iteration(self):
        """Test one iteration of replacement"""
        result = lsystem_iterate("F", "F[+F]", 1)
        assert result == "F[+F]"

    def test_multiple_iterations(self):
        """Test multiple iterations"""
        result = lsystem_iterate("F", "F[+F]", 2)
        assert result == "F[+F][+F[+F]]"

    def test_zero_iterations(self):
        """Zero iterations should return axiom"""
        result = lsystem_iterate("F", "F[+F]", 0)
        assert result == "F"


class TestLSystemInterpretation:
    """Test L-system string interpretation to coordinates"""

    def test_simple_forward(self):
        """Test simple forward movement"""
        branches = interpret_lsystem(
            lstring="F",
            start_pos=(0, 0),
            start_angle=90,
            initial_length=10,
            base_angle_delta=25,
            node_id="test-id",
            depth=0
        )
        assert len(branches) == 1
        assert branches[0]["start"] == [0, 0]
        assert branches[0]["node_id"] == "test-id"
        assert branches[0]["depth"] == 0

    def test_branching(self):
        """Test branching creates multiple segments"""
        branches = interpret_lsystem(
            lstring="F[+F][-F]",
            start_pos=(0, 0),
            start_angle=90,
            initial_length=10,
            base_angle_delta=25,
            node_id="test-id",
            depth=0
        )
        assert len(branches) == 3  # Main + 2 branches

    def test_thickness_by_depth(self):
        """Test thickness decreases with depth"""
        branches_shallow = interpret_lsystem(
            lstring="F",
            start_pos=(0, 0),
            start_angle=90,
            initial_length=10,
            base_angle_delta=25,
            node_id="test-id",
            depth=0
        )
        branches_deep = interpret_lsystem(
            lstring="F",
            start_pos=(0, 0),
            start_angle=90,
            initial_length=10,
            base_angle_delta=25,
            node_id="test-id",
            depth=5
        )
        assert branches_shallow[0]["thickness"] > branches_deep[0]["thickness"]


class TestSkeletonGeneration:
    """Test complete skeleton generation"""

    def test_empty_tree_data(self):
        """Empty tree should return empty skeleton"""
        skeleton = generate_lsystem_skeleton([])
        assert skeleton["branches"] == []
        assert skeleton["canvas_size"] == [512, 512]

    def test_single_root_node(self):
        """Single root node should generate skeleton"""
        tree_data = [{
            "id": "root-id",
            "name": "Root",
            "depth": 0,
            "parent_id": None,
            "child_count": 2,
            "mastery_score": 0.5
        }]
        skeleton = generate_lsystem_skeleton(tree_data)
        assert len(skeleton["branches"]) > 0
        assert skeleton["canvas_size"] == [512, 512]

    def test_no_root_fallback(self):
        """Should handle missing root by using depth=0 node"""
        tree_data = [{
            "id": "node-id",
            "name": "Node",
            "depth": 0,
            "parent_id": "fake-parent",
            "child_count": 1,
            "mastery_score": 0.5
        }]
        skeleton = generate_lsystem_skeleton(tree_data)
        assert len(skeleton["branches"]) > 0


class TestPNGRendering:
    """Test PNG rendering"""

    def test_render_creates_image(self):
        """Test that rendering creates valid PNG"""
        skeleton_data = {
            "branches": [
                {
                    "start": [100, 100],
                    "end": [200, 200],
                    "thickness": 5,
                    "node_id": "test",
                    "depth": 0
                }
            ],
            "canvas_size": [512, 512]
        }
        png_bytes = render_skeleton_png(skeleton_data)
        assert isinstance(png_bytes, BytesIO)
        assert png_bytes.tell() == 0  # Should be at start
        assert len(png_bytes.getvalue()) > 0  # Should have content

    def test_render_empty_skeleton(self):
        """Test rendering empty skeleton"""
        skeleton_data = {
            "branches": [],
            "canvas_size": [512, 512]
        }
        png_bytes = render_skeleton_png(skeleton_data)
        assert isinstance(png_bytes, BytesIO)
        assert len(png_bytes.getvalue()) > 0  # Should still create blank image


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
