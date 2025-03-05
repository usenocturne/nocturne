#!/bin/sh
# usage: use colour_echo -COLOUR "Text"
#        -COLOUR can be before or after the text

# reset console colours
ColourOff='\033[0m'
Prefix='\033[0;'
# red is 31
Index=31
Colours_Name="Red Green Yellow Blue Purple Cyan White"
COLOUR="Green"

# get text and colour
while test ${#} -gt 0; do
  if echo "$1" | grep -q "^-"; then
    # remove -
    COLOUR=$(echo "$1" | sed "s/^.//")
  else
    Text="$1"
  fi
  shift
done

# find colour number
for col in ${Colours_Name}; do
  [ "$col" = "$COLOUR" ] && break
  Index=$((Index + 1))
done

printf "%b\n" "${Prefix}${Index}m${Text}${ColourOff}"
