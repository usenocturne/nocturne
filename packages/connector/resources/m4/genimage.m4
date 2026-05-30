image xIMAGE {
  xFS {
    label = "xLABEL"
    ifdef(`xUSEMKE2FS', `use-mke2fs = true')
    ifdef(`xFEATURES', `features = "xFEATURES"')
    ifdef(`xEXTRAARGS', `extraargs = "xEXTRAARGS"')
  }
  size = xSIZE
}