#!/bin/bash
# Recursively convert all .sh files to LF line endings

find . -type f -name "*.sh" -print0 | while IFS= read -r -d '' file; do
  echo "Converting $file"
  # Use sed to strip carriage returns
  sed -i 's/\r$//' "$file"
done

echo "Done converting all .sh files to LF."
