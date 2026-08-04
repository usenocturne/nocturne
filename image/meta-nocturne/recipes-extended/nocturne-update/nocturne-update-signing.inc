# Shared release signing policy for all Nocturne SWU recipes.

NOCTURNE_SWUPDATE_PRIVATE_KEY ?= ""
NOCTURNE_SWUPDATE_PUBLIC_KEY = "${NOCTURNE_LAYERDIR}/recipes-core/nocturne-keys/files/nocturne.pem"

# Override the BSP descriptions so every installed image is bound to the
# signed description by its exact SHA-256. SWUpdate rejects signed containers
# with even one unhashed image entry.
FILESEXTRAPATHS:prepend := "${NOCTURNE_LAYERDIR}/recipes-extended/nocturne-update/files/${SUPERBIRD_OTA_SW_DESCRIPTION_VARIANT}:"

SWUPDATE_SIGNING = "${@'RSA' if d.getVar('NOCTURNE_SWUPDATE_SIGNING_MODE') == 'production' else ''}"
SWUPDATE_PRIVATE_KEY = "${NOCTURNE_SWUPDATE_PRIVATE_KEY}"

python do_validate_nocturne_sw_description() {
    import pathlib
    import re

    description_path = pathlib.Path(d.getVar("UNPACKDIR")) / "sw-description"
    description = description_path.read_text()
    filenames = re.findall(r'\bfilename\s*=\s*"([^"]+)"\s*;', description)
    hashed = re.findall(
        r'\bfilename\s*=\s*"([^"]+)"\s*;\s*'
        r'sha256\s*=\s*"\$swupdate_get_sha256\(([^)]+)\)"\s*;',
        description,
    )

    if not filenames:
        bb.fatal("No image filenames found in %s" % description_path)
    if len(hashed) != len(filenames):
        bb.fatal(
            "%s declares %d image filenames but only %d adjacent SHA-256 placeholders"
            % (description_path, len(filenames), len(hashed))
        )
    for filename, hash_source in hashed:
        if filename != hash_source:
            bb.fatal(
                "%s hashes %s with the wrong staged member %s"
                % (description_path, filename, hash_source)
            )
}
addtask validate_nocturne_sw_description after do_render_sw_description before do_validate_nocturne_signing

python do_validate_nocturne_signing() {
    import pathlib
    import subprocess

    mode = d.getVar("NOCTURNE_SWUPDATE_SIGNING_MODE")
    if mode == "development-unsigned":
        bb.warn("Building an explicitly unsigned development SWU")
        return
    if mode != "production":
        bb.fatal("Invalid NOCTURNE_SWUPDATE_SIGNING_MODE: %r" % mode)

    private_key = d.getVar("NOCTURNE_SWUPDATE_PRIVATE_KEY")
    if not private_key:
        bb.fatal(
            "Production SWU signing requires NOCTURNE_SWUPDATE_PRIVATE_KEY to "
            "name a readable secret-mounted RSA private key. For local-only "
            "unsigned artifacts, explicitly set "
            "NOCTURNE_SWUPDATE_SIGNING_MODE=development-unsigned."
        )

    private_path = pathlib.Path(private_key)
    if not private_path.is_file():
        bb.fatal("NOCTURNE_SWUPDATE_PRIVATE_KEY is not a file: %s" % private_key)

    public_path = pathlib.Path(d.getVar("NOCTURNE_SWUPDATE_PUBLIC_KEY"))
    openssl = pathlib.Path(d.getVar("STAGING_BINDIR_NATIVE")) / "openssl"
    try:
        derived_public = subprocess.check_output(
            [str(openssl), "pkey", "-in", str(private_path), "-pubout"],
            stderr=subprocess.STDOUT,
        )
    except subprocess.CalledProcessError as error:
        bb.fatal(
            "Failed to read NOCTURNE_SWUPDATE_PRIVATE_KEY with OpenSSL: %s"
            % error.output.decode(errors="replace")
        )

    if derived_public.strip() != public_path.read_bytes().strip():
        bb.fatal(
            "NOCTURNE_SWUPDATE_PRIVATE_KEY does not match the public key baked "
            "into the image at %s" % public_path
        )
}
do_validate_nocturne_signing[depends] += "openssl-native:do_populate_sysroot"
addtask validate_nocturne_signing after do_render_sw_description before do_swuimage
