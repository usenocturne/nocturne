SUMMARY = "ONNX wake-word + audio preprocessing models for nocturned"
DESCRIPTION = "Bundled ONNX assets loaded by nocturned for wake-word detection (hey nocturne / hey spotify / ok nocturne / ok spotify) and audio preprocessing."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = " \
    file://embedding_model.onnx \
    file://hey_nocturne.onnx \
    file://hey_spotify.onnx \
    file://melspectrogram.onnx \
    file://ok_nocturne.onnx \
    file://ok_spotify.onnx \
"
S = "${UNPACKDIR}"

inherit allarch

MODELS_DIR = "${sysconfdir}/nocturne/models"

do_install() {
    install -d ${D}${MODELS_DIR}
    install -m 0644 ${S}/embedding_model.onnx ${D}${MODELS_DIR}/embedding_model.onnx
    install -m 0644 ${S}/hey_nocturne.onnx    ${D}${MODELS_DIR}/hey_nocturne.onnx
    install -m 0644 ${S}/hey_spotify.onnx     ${D}${MODELS_DIR}/hey_spotify.onnx
    install -m 0644 ${S}/melspectrogram.onnx  ${D}${MODELS_DIR}/melspectrogram.onnx
    install -m 0644 ${S}/ok_nocturne.onnx     ${D}${MODELS_DIR}/ok_nocturne.onnx
    install -m 0644 ${S}/ok_spotify.onnx      ${D}${MODELS_DIR}/ok_spotify.onnx
}

FILES:${PN} = "${MODELS_DIR}"
