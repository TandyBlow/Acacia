#!/bin/bash

# Tree Generator Setup Script
# Automates the setup process for the L-system tree visualization generator

set -e

echo "🌳 SeeWhat Tree Generator Setup"
echo "================================"
echo ""

# Check if we're in the backend directory
if [ ! -f "tree_generator.py" ]; then
    echo "❌ Error: Please run this script from the backend/ directory"
    exit 1
fi

# Step 1: Install dependencies
echo "📦 Step 1: Installing Python dependencies..."
pip install -r requirements.txt
echo "✓ Dependencies installed"
echo ""

# Step 2: Check for .env file
echo "🔧 Step 2: Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env and add your Supabase credentials:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_KEY"
    echo ""
    echo "Get these from: https://app.supabase.com/project/_/settings/api"
    echo ""
    read -p "Press Enter after you've configured .env..."
else
    echo "✓ .env file exists"
fi
echo ""

# Step 3: Verify Supabase connection
echo "🔌 Step 3: Verifying Supabase connection..."
python -c "
from dotenv import load_dotenv
from os import getenv
load_dotenv()
url = getenv('SUPABASE_URL')
key = getenv('SUPABASE_SERVICE_KEY')
if not url or not key or 'your-project-id' in url or 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' in key:
    print('❌ Error: Please configure SUPABASE_URL and SUPABASE_SERVICE_KEY in .env')
    exit(1)
print('✓ Supabase credentials configured')
"
echo ""

# Step 4: Database migration reminder
echo "📊 Step 4: Database setup"
echo "⚠️  Manual action required:"
echo "   1. Go to Supabase Dashboard > SQL Editor"
echo "   2. Run the migration: ../supabase/migrations/20260418000000_add_tree_skeletons.sql"
echo ""
read -p "Press Enter after you've run the migration..."
echo ""

# Step 5: Storage bucket reminder
echo "💾 Step 5: Storage setup"
echo "⚠️  Manual action required:"
echo "   1. Go to Supabase Dashboard > Storage"
echo "   2. Create a new bucket named: tree-assets"
echo "   3. Set it to Public"
echo ""
read -p "Press Enter after you've created the bucket..."
echo ""

# Step 6: Run tests
echo "🧪 Step 6: Running unit tests..."
if pytest test_tree_generator_unit.py -v; then
    echo "✓ All tests passed"
else
    echo "⚠️  Some tests failed, but you can continue"
fi
echo ""

# Done
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  • Test with: python test_tree_generator.py <user_id>"
echo "  • Or start API: uvicorn main:app --reload"
echo "  • Then POST to: http://localhost:8000/generate-tree/<user_id>"
echo ""
