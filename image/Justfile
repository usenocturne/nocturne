menuconfig:
    make -C buildroot BR2_EXTERNAL="$PWD/external" O="$PWD/output" BR2_DEFCONFIG="$PWD/configs/nocturne_defconfig" menuconfig

copyconfig:
    rm -f configs/nocturne_defconfig
    cp output/.config configs/nocturne_defconfig

savedefconfig:
    make -C buildroot O="$PWD/output" savedefconfig
    rm -f configs/nocturne_defconfig
    cp output/defconfig configs/nocturne_defconfig

clean:
    make -C buildroot O="$PWD/output" clean
    rm -rf output/package

wslpath:
    export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/usr/lib/wsl/lib