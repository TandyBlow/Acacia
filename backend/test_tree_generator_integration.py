"""
Integration test for tree_generator.py with mock Supabase data
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from tree_generator import (
    fetch_user_tree,
    generate_tree_visualization,
    save_skeleton,
)


@pytest.fixture
def mock_supabase():
    """Mock Supabase client"""
    with patch('tree_generator.supabase') as mock:
        yield mock


@pytest.fixture
def sample_nodes():
    """Sample node data"""
    return [
        {
            "id": "root-1",
            "name": "Root Node",
            "content": {"markdown": "Root content"},
            "depth": 0,
            "parent_id_cache": None
        },
        {
            "id": "child-1",
            "name": "Child 1",
            "content": {"markdown": "Child 1 content"},
            "depth": 1,
            "parent_id_cache": "root-1"
        },
        {
            "id": "child-2",
            "name": "Child 2",
            "content": {"markdown": "Child 2 content"},
            "depth": 1,
            "parent_id_cache": "root-1"
        },
    ]


@pytest.fixture
def sample_edges():
    """Sample edge data"""
    return [
        {
            "parent_id": "root-1",
            "child_id": "child-1",
            "sort_order": 0
        },
        {
            "parent_id": "root-1",
            "child_id": "child-2",
            "sort_order": 1
        },
    ]


class TestFetchUserTree:
    """Test fetching tree data from Supabase"""

    def test_fetch_with_data(self, mock_supabase, sample_nodes, sample_edges):
        """Test fetching tree with valid data"""
        # Mock nodes response
        nodes_mock = Mock()
        nodes_mock.data = sample_nodes
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = nodes_mock

        # Mock edges response
        edges_mock = Mock()
        edges_mock.data = sample_edges
        mock_supabase.table.return_value.select.return_value.in_.return_value.execute.return_value = edges_mock

        result = fetch_user_tree("test-user-id")

        assert len(result) == 3
        assert result[0]["id"] == "root-1"
        assert result[0]["child_count"] == 2
        assert result[1]["child_count"] == 0
        assert result[2]["child_count"] == 0

    def test_fetch_empty_tree(self, mock_supabase):
        """Test fetching tree with no data"""
        nodes_mock = Mock()
        nodes_mock.data = []
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = nodes_mock

        result = fetch_user_tree("test-user-id")

        assert result == []


class TestSaveSkeleton:
    """Test saving skeleton to Supabase"""

    def test_save_skeleton_success(self, mock_supabase):
        """Test successful skeleton save"""
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

        from io import BytesIO
        png_bytes = BytesIO(b"fake-png-data")

        # Mock storage upload
        storage_mock = Mock()
        storage_mock.upload.return_value = {"path": "test-user/test.png"}
        storage_mock.get_public_url.return_value = "https://example.com/test.png"
        mock_supabase.storage.from_.return_value = storage_mock

        # Mock table insert
        table_mock = Mock()
        table_mock.insert.return_value.execute.return_value = Mock()
        mock_supabase.table.return_value = table_mock

        result = save_skeleton("test-user", skeleton_data, png_bytes)

        assert result == "https://example.com/test.png"
        storage_mock.upload.assert_called_once()
        table_mock.insert.assert_called_once()


class TestGenerateTreeVisualization:
    """Test end-to-end tree generation"""

    def test_generate_with_valid_user(self, mock_supabase, sample_nodes, sample_edges):
        """Test generating tree for valid user"""
        # Mock nodes response
        nodes_mock = Mock()
        nodes_mock.data = sample_nodes

        # Mock edges response
        edges_mock = Mock()
        edges_mock.data = sample_edges

        # Mock storage
        storage_mock = Mock()
        storage_mock.upload.return_value = {"path": "test-user/test.png"}
        storage_mock.get_public_url.return_value = "https://example.com/test.png"

        # Mock table
        table_mock = Mock()
        table_mock.insert.return_value.execute.return_value = Mock()

        # Setup mock chain
        def table_side_effect(table_name):
            if table_name == "nodes":
                return Mock(
                    select=Mock(return_value=Mock(
                        eq=Mock(return_value=Mock(
                            eq=Mock(return_value=Mock(
                                execute=Mock(return_value=nodes_mock)
                            ))
                        ))
                    ))
                )
            elif table_name == "edges":
                return Mock(
                    select=Mock(return_value=Mock(
                        in_=Mock(return_value=Mock(
                            execute=Mock(return_value=edges_mock)
                        ))
                    ))
                )
            else:  # tree_skeletons
                return table_mock

        mock_supabase.table.side_effect = table_side_effect
        mock_supabase.storage.from_.return_value = storage_mock

        result = generate_tree_visualization("test-user-id")

        assert result == "https://example.com/test.png"

    def test_generate_with_no_data(self, mock_supabase):
        """Test generating tree for user with no data"""
        nodes_mock = Mock()
        nodes_mock.data = []
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = nodes_mock

        with pytest.raises(ValueError, match="No tree data found"):
            generate_tree_visualization("test-user-id")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
