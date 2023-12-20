#!/usr/bin/env bash

# Fetch packages from Ubuntu or Debian repos as given
#   and extracts them to an output folder
#   usage: ./fake_debootstrap.sh <output-dir> <packages>

#   this works pretty similar to debootstrap: use apt to fetch packges, and then extract them

###################################### Execution Guard #####################################

if command -v lsb_release; then
    DIST_ID=$(lsb_release -i | awk -F"\t" '{print $2}')
else
    # no lsb_release, unknown distribution
    DIST_ID="unknown"
fi
echo "  This system is: ${DIST_ID} $(uname -s) $(uname -m)"

# only works on Linux
if [ "$(uname -s)" != "Linux" ]; then
    echo "This script is only compatible with Debian/Ubuntu Linux"
    exit 1
fi

if [ "$DIST_ID" == "Debian" ] || [ "$DIST_ID" == "Ubuntu" ]; then
    echo "Compatible distribution"
else
    echo "This script is only compatible with Debian/Ubuntu Linux"
    exit 1
fi

###################################### Variables #####################################

# commands needed to run this script
# NEEDED_CMDS="ar curl tar awk"

# packages to be installed

OUTPUT_FILE="$1"
PACKAGES="${*:2}"

if [ -z "$OUTPUT_FILE" ] || [ -z "$PACKAGES" ]; then
    echo "missing args! usage: ./fake_debootstrap.sh <output-file> <packages>"
    exit 1
fi

THIS_DIR=$(dirname "$(realpath "$0")")
TEMP_DIR="${THIS_DIR}/temp"
OUTPUT_DIR="${TEMP_DIR}/output_root"



###################################### Functions #####################################


function bail() {
    echo "Error: something went wrong!"
    exit 1
}

function extract_package() {
    # extract contents of .deb package to an output folder
    FILE_NAME="$1"
    OUTPUT="$2"
    echo "Extracting $FILE_NAME"
    mkdir "${TEMP_DIR}/scratch"
    cp "$FILE_NAME" "${TEMP_DIR}/scratch/tempfile.deb"
    pushd "${TEMP_DIR}/scratch" >/dev/null || bail
    ar x tempfile.deb || bail
    rm control.tar.* debian-binary tempfile.deb || bail
    if [ -f "data.tar.xz" ]; then
        tar xf data.tar.xz -C "$OUTPUT" || bail
        rm data.tar.xz || bail
    elif [ -f "data.tar.gz" ]; then
        tar xf data.tar.gz -C "$OUTPUT" || bail
        rm data.tar.gz || bail
    elif [ -f "data.tar.zst" ]; then
        tar xf data.tar.zst -C "$OUTPUT" || bail
        rm data.tar.zst || bail
    else
        echo "could not figure out data format"
        ls
        exit 1
    fi
    popd >/dev/null || bail
    rm -r "${TEMP_DIR}/scratch" || bail
}

###################################### Execution #####################################

if [ -d "$TEMP_DIR" ]; then
    rm -r "$TEMP_DIR" || bail
fi


mkdir "$TEMP_DIR" || bail
mkdir -p "$OUTPUT_DIR" || bail

echo "Going to consolidate packages into [${OUTPUT_FILE}]: $PACKAGES"

pushd "$TEMP_DIR" >/dev/null|| bail

cat << EOF > apt.conf
Dir::Etc::main ".";
Dir::Etc::Parts "./apt.conf.d";
Dir::Etc::sourcelist "./sources.list";
Dir::Etc::sourceparts "./sources.list.d";
Dir::State "./apt-tmp";
Dir::State::status "./apt-tmp/status";
Dir::Cache "./apt-tmp";
EOF

# cat << EOF > sources.list
# # deb http://deb.debian.org/debian/ bullseye main contrib non-free
# deb http://ports.ubuntu.com/ kinetic main restricted universe multiverse
# deb http://ports.ubuntu.com/ kinetic-security main restricted universe multiverse
# deb http://ports.ubuntu.com/ kinetic-updates main restricted universe multiverse
# deb http://ports.ubuntu.com/ kinetic-backports main restricted universe multiverse
# EOF

cp /etc/apt/sources.list sources.list

mkdir -p sources.list.d || bail
mkdir -p apt-tmp/lists/partial || bail
touch apt-tmp/status || bail

apt-get -c apt.conf update || bail

apt-get -c apt.conf install -y -d $PACKAGES || bail

popd || bail

pushd "${TEMP_DIR}/apt-tmp/archives" || bail

for DEB_FILE in ./*.deb; do
    extract_package "$DEB_FILE" "$OUTPUT_DIR"
done

pushd "$OUTPUT_DIR" || bail

tar czf "${THIS_DIR}/${OUTPUT_FILE}" ./*

popd || bail

###################################### Cleanup #####################################

rm -r "$TEMP_DIR"

echo "Finished creating: $OUTPUT_FILE"
