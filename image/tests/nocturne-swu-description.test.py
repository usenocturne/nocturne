#!/usr/bin/env python3

import hashlib
import pathlib
import re
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DESCRIPTIONS = ROOT / "meta-nocturne/recipes-extended/nocturne-update/files"
SIGNING_INCLUDE = (
    ROOT
    / "meta-nocturne/recipes-extended/nocturne-update/nocturne-update-signing.inc"
)

EXPECTED = {
    "full": {"boot.vfat", "system.img"},
    "delta": {"boot.vfat.zck.zckheader", "system.img.zck.zckheader"},
}

PLACEHOLDER_PATTERN = re.compile(
    r'\bfilename\s*=\s*"([^"]+)"\s*;\s*'
    r'sha256\s*=\s*"\$swupdate_get_sha256\(([^)]+)\)"\s*;'
)
FILENAME_PATTERN = re.compile(r'\bfilename\s*=\s*"([^"]+)"\s*;')
RENDERED_PATTERN = re.compile(
    r'\bfilename\s*=\s*"([^"]+)"\s*;\s*'
    r'sha256\s*=\s*"([a-f0-9]{64})"\s*;'
)
COMPRESSED_PATTERN = re.compile(r'\bcompressed\s*=\s*"([^"]+)"\s*;')


def render_hashes(description: str, members: pathlib.Path) -> str:
    def replace(match: re.Match[str]) -> str:
        member = match.group(1)
        source = match.group(2)
        assert member == source
        digest = hashlib.sha256((members / source).read_bytes()).hexdigest()
        return f'filename = "{member}";\n                    sha256 = "{digest}";'

    return PLACEHOLDER_PATTERN.sub(replace, description)


def validate_variant(variant: str) -> None:
    description_path = DESCRIPTIONS / variant / "sw-description"
    description = description_path.read_text()
    filenames = FILENAME_PATTERN.findall(description)
    declarations = PLACEHOLDER_PATTERN.findall(description)

    assert len(filenames) == 4, f"{variant}: expected two images in both selectors"
    assert len(declarations) == len(filenames), f"{variant}: unhashed image entry"
    assert {filename for filename, _ in declarations} == EXPECTED[variant]
    assert all(filename == source for filename, source in declarations)
    compression = COMPRESSED_PATTERN.findall(description)
    if variant == "full":
        assert compression == ["zstd"] * len(filenames)
    else:
        assert not compression, "delta headers must not be decompressed by SWUpdate"

    with tempfile.TemporaryDirectory(prefix=f"nocturne-{variant}-hashes-") as temp:
        members = pathlib.Path(temp)
        for index, member in enumerate(sorted(EXPECTED[variant])):
            (members / member).write_bytes(
                f"{variant}:{member}:{index}\n".encode() * (index + 1)
            )

        rendered = render_hashes(description, members)
        rendered_images = RENDERED_PATTERN.findall(rendered)
        assert len(rendered_images) == len(filenames)
        for member, expected in rendered_images:
            actual = hashlib.sha256((members / member).read_bytes()).hexdigest()
            assert expected == actual, f"{variant}: wrong hash for {member}"


def validate_task_order() -> None:
    signing = SIGNING_INCLUDE.read_text()
    task_order = re.search(
        r"addtask validate_nocturne_sw_description "
        r"after do_render_sw_description before do_validate_nocturne_signing",
        signing,
    )
    signing_order = re.search(
        r"addtask validate_nocturne_signing "
        r"after do_render_sw_description before do_swuimage",
        signing,
    )
    assert task_order, "hash declaration validation must follow description rendering"
    assert signing_order, "signing validation must precede SWU construction"
    assert 'SWUPDATE_SIGNING = "${@\'RSA\'' in signing


for name in EXPECTED:
    validate_variant(name)
validate_task_order()
print("Nocturne signed sw-description tests passed")
