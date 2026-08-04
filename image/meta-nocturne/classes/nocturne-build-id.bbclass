python __anonymous() {
    import re

    build_id = d.getVar("NOCTURNE_BUILD_ID") or ""
    if not re.fullmatch(r"[0-9]{14}", build_id):
        bb.fatal(
            "NOCTURNE_BUILD_ID must contain exactly 14 decimal digits "
            "(YYYYMMDDhhmmss), got %r" % build_id
        )
}
