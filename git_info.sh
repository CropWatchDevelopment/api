#!/bin/bash

# Get the current Git commit hash
commit_hash=$(git rev-parse HEAD)

# Get the user who made the last commit
commit_user=$(git log -1 --pretty=format:'%an')

# Get the current Git branch
branch_name=$(git rev-parse --abbrev-ref HEAD)

# Get the commit time in a readable format
commit_time=$(git log -1 --pretty=format:'%ci')

# Get the computer's hostname
computer_name=$(hostname)

# Get the computer's local IP address
# Adjust for different OS (this example works for Linux and macOS)
ip_address=$(hostname -I | awk '{print $1}') # For Linux
if [[ -z "$ip_address" ]]; then
  ip_address=$(ipconfig getifaddr en0 2>/dev/null) || ip_address=$(ipconfig getifaddr en1 2>/dev/null) # For macOS
fi

# Output the gathered information in JSON format to /src/git_info.json
cat <<EOF > ./src/git_info.json
{
  "commit_hash": "$commit_hash",
  "commit_user": "$commit_user",
  "branch_name": "$branch_name",
  "commit_time": "$commit_time",
  "computer_name": "$computer_name",
  "ip_address": "$ip_address"
}
EOF

echo "JSON output saved to ./src/git_info.json"
