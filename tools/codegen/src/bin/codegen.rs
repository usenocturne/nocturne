use std::{
    env,
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use nocturne_codegen::dispatch::{
    inventory,
    kotlin::emit_kotlin_inventory_to_dir,
    rust::{IAP2_CSM_OUTPUT, emit_iap2_csm_to_file, emit_rust_inventory_to_dir},
    swift::emit_swift_inventory_to_dir,
    typescript::emit_typescript_inventory_to_dir,
};

const LIB_SRC: &str = "crates/shared/src";
const LOCAL_GENERATED: &str = "crates/shared/generated";
const IOS_MIRROR_ENV: &str = "NOCTURNE_APP_IOS_GENERATED";
const ANDROID_MIRROR_ENV: &str = "NOCTURNE_APP_ANDROID_GENERATED";

#[derive(Debug, Default)]
struct Args {
    mirror: bool,
    check: bool,
}

#[derive(Debug)]
struct OutputPaths {
    rust: PathBuf,
    iap2_csm: PathBuf,
    typescript: PathBuf,
    swift: PathBuf,
    kotlin: PathBuf,
    ios_mirror: PathBuf,
    android_mirror: PathBuf,
}

#[derive(Debug, Clone, Copy)]
enum Lang {
    Rust,
    TypeScript,
    Swift,
    Kotlin,
}

impl Lang {
    fn generated_extension(self) -> &'static str {
        match self {
            Self::Rust => "rs",
            Self::TypeScript => "d.ts",
            Self::Swift => "swift",
            Self::Kotlin => "kt",
        }
    }
}

fn main() -> Result<()> {
    let args = parse_args()?;
    let workspace = workspace_root()?;
    let paths = OutputPaths::resolve(&workspace)?;
    let inv =
        inventory(&workspace.join(LIB_SRC).to_string_lossy()).context("build codegen inventory")?;

    if args.check {
        check_outputs(&inv, &paths, args.mirror)
    } else {
        write_outputs(&inv, &paths, args.mirror)
    }
}

fn parse_args() -> Result<Args> {
    let mut args = Args::default();
    for arg in env::args().skip(1) {
        match arg.as_str() {
            "--mirror" => args.mirror = true,
            "--check" => args.check = true,
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            other => bail!("unknown argument {other:?}; expected --mirror, --check, or --help"),
        }
    }
    Ok(args)
}

fn print_help() {
    println!(
        "nocturne-codegen\n\nUSAGE:\n    cargo run -p nocturne-codegen --bin codegen -- [--mirror] [--check]\n\nFLAGS:\n    --mirror    Also write Swift/Kotlin into sibling nocturne-app generated trees\n    --check     Compare generated output against existing files and fail on drift\n\nPATHS:\n    Local output: crates/shared/generated/{{rust,ts,swift,kotlin}} and crates/iap2/src/csm/generated.rs\n    Mirror output defaults to ../nocturne-app/... from this repo. Override with {IOS_MIRROR_ENV} and {ANDROID_MIRROR_ENV}."
    );
}

fn workspace_root() -> Result<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .context("resolve workspace root")
}

impl OutputPaths {
    fn resolve(workspace: &Path) -> Result<Self> {
        let local = workspace.join(LOCAL_GENERATED);
        let sibling_root = workspace
            .parent()
            .context("workspace has parent for mirror defaults")?;
        Ok(Self {
            rust: local.join("rust"),
            iap2_csm: workspace.join(IAP2_CSM_OUTPUT),
            typescript: local.join("ts"),
            swift: local.join("swift"),
            kotlin: local.join("kotlin"),
            ios_mirror: env_path(
                workspace,
                IOS_MIRROR_ENV,
                sibling_root.join("nocturne-app/ios/Sources/Nocturne/Generated"),
            ),
            android_mirror: env_path(
                workspace,
                ANDROID_MIRROR_ENV,
                sibling_root.join("nocturne-app/android/app/src/main/kotlin/generated"),
            ),
        })
    }
}

fn env_path(workspace: &Path, key: &str, default: PathBuf) -> PathBuf {
    match env::var_os(key) {
        Some(value) => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                workspace.join(path)
            }
        }
        None => default,
    }
}

fn write_outputs(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    paths: &OutputPaths,
    mirror: bool,
) -> Result<()> {
    emit_all(inv, paths, mirror)
}

fn check_outputs(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    paths: &OutputPaths,
    mirror: bool,
) -> Result<()> {
    let temp_root = env::temp_dir().join(format!("nocturne-codegen-check-{}", std::process::id()));
    recreate_dir(&temp_root)?;
    let temp_paths = OutputPaths {
        rust: temp_root.join("rust"),
        iap2_csm: temp_root.join("iap2_csm/generated.rs"),
        typescript: temp_root.join("ts"),
        swift: temp_root.join("swift"),
        kotlin: temp_root.join("kotlin"),
        ios_mirror: temp_root.join("ios"),
        android_mirror: temp_root.join("android"),
    };

    let result = (|| {
        emit_all(inv, &temp_paths, mirror)?;
        compare_dir(&temp_paths.rust, &paths.rust, Lang::Rust)?;
        compare_file(&temp_paths.iap2_csm, &paths.iap2_csm)?;
        compare_dir(&temp_paths.typescript, &paths.typescript, Lang::TypeScript)?;
        compare_dir(&temp_paths.swift, &paths.swift, Lang::Swift)?;
        compare_dir(&temp_paths.kotlin, &paths.kotlin, Lang::Kotlin)?;
        if mirror {
            compare_dir(&temp_paths.ios_mirror, &paths.ios_mirror, Lang::Swift)?;
            compare_dir(
                &temp_paths.android_mirror,
                &paths.android_mirror,
                Lang::Kotlin,
            )?;
        }
        Ok(())
    })();

    let cleanup = fs::remove_dir_all(&temp_root);
    if let Err(error) = cleanup
        && result.is_ok()
    {
        return Err(error).with_context(|| format!("remove {}", temp_root.display()));
    }
    result
}

fn emit_all(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    paths: &OutputPaths,
    mirror: bool,
) -> Result<()> {
    emit_lang(inv, Lang::Rust, &paths.rust)?;
    emit_iap2_csm(inv, &paths.iap2_csm)?;
    emit_lang(inv, Lang::TypeScript, &paths.typescript)?;
    emit_lang(inv, Lang::Swift, &paths.swift)?;
    emit_lang(inv, Lang::Kotlin, &paths.kotlin)?;
    if mirror {
        emit_swift_ios_mirror(inv, &paths.ios_mirror)?;
        emit_lang(inv, Lang::Kotlin, &paths.android_mirror)?;
    }
    Ok(())
}

fn emit_swift_ios_mirror(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    out_dir: &Path,
) -> Result<()> {
    emit_lang(inv, Lang::Swift, out_dir)?;
    let generated_path = out_dir.join("Generated.swift");
    let module_path = out_dir.join("GeneratedModule.swift");
    fs::rename(&generated_path, &module_path).with_context(|| {
        format!(
            "rename {} to {}",
            generated_path.display(),
            module_path.display()
        )
    })
}

fn emit_iap2_csm(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    out_file: &Path,
) -> Result<()> {
    emit_iap2_csm_to_file(inv.csms, out_file)?;
    format_rust_files(&[out_file.to_path_buf()])
}

fn emit_lang(
    inv: &nocturne_codegen::dispatch::inventory::Inventory,
    lang: Lang,
    out_dir: &Path,
) -> Result<()> {
    clean_generated_files(out_dir, lang.generated_extension())?;
    match lang {
        Lang::Rust => {
            emit_rust_inventory_to_dir(inv, out_dir)?;
            format_rust_dir(out_dir)
        }
        Lang::TypeScript => emit_typescript_inventory_to_dir(inv, out_dir),
        Lang::Swift => emit_swift_inventory_to_dir(inv, out_dir),
        Lang::Kotlin => emit_kotlin_inventory_to_dir(inv, out_dir),
    }
    .with_context(|| format!("emit {lang:?} to {}", out_dir.display()))
}

fn format_rust_dir(out_dir: &Path) -> Result<()> {
    let files = generated_files(out_dir, "rs")?;
    if files.is_empty() {
        return Ok(());
    }
    format_rust_files(&files)
}

fn format_rust_files(files: &[PathBuf]) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    let status = Command::new("rustfmt")
        .arg("--edition")
        .arg("2024")
        .args(files)
        .status()
        .context("spawn rustfmt")?;
    if !status.success() {
        bail!("rustfmt exited with {status}");
    }
    Ok(())
}

fn compare_file(expected_path: &Path, actual_path: &Path) -> Result<()> {
    let expected_bytes =
        fs::read(expected_path).with_context(|| format!("read {}", expected_path.display()))?;
    let actual_bytes =
        fs::read(actual_path).with_context(|| format!("read {}", actual_path.display()))?;
    if expected_bytes != actual_bytes {
        bail!("codegen drift in {}", actual_path.display());
    }
    Ok(())
}

fn recreate_dir(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).with_context(|| format!("remove {}", path.display())),
    }
    fs::create_dir_all(path).with_context(|| format!("create {}", path.display()))
}

fn clean_generated_files(dir: &Path, extension: &str) -> Result<()> {
    fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    for entry in fs::read_dir(dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && has_generated_extension(&path, extension) {
            fs::remove_file(&path).with_context(|| format!("remove {}", path.display()))?;
        }
    }
    Ok(())
}

fn compare_dir(expected_dir: &Path, actual_dir: &Path, lang: Lang) -> Result<()> {
    let extension = lang.generated_extension();
    let expected = generated_files(expected_dir, extension)?;
    let actual = generated_files(actual_dir, extension)?;

    let expected_rel: Vec<PathBuf> = expected
        .iter()
        .map(|path| relative_to(path, expected_dir))
        .collect();
    let actual_rel: Vec<PathBuf> = actual
        .iter()
        .map(|path| relative_to(path, actual_dir))
        .collect();

    if expected_rel != actual_rel {
        bail!(
            "codegen drift in {}: expected files {:?}, actual files {:?}",
            actual_dir.display(),
            expected_rel,
            actual_rel
        );
    }

    for rel in expected_rel {
        let expected_path = expected_dir.join(&rel);
        let actual_path = actual_dir.join(&rel);
        let expected_bytes = fs::read(&expected_path)
            .with_context(|| format!("read {}", expected_path.display()))?;
        let actual_bytes =
            fs::read(&actual_path).with_context(|| format!("read {}", actual_path.display()))?;
        if expected_bytes != actual_bytes {
            bail!("codegen drift in {}", actual_path.display());
        }
    }
    Ok(())
}

fn generated_files(dir: &Path, extension: &str) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !dir.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && has_generated_extension(&path, extension) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn relative_to(path: &Path, base: &Path) -> PathBuf {
    path.strip_prefix(base).unwrap_or(path).to_path_buf()
}

fn has_generated_extension(path: &Path, extension: &str) -> bool {
    if extension == "d.ts" {
        return path
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.ends_with(".d.ts"));
    }
    path.extension().and_then(OsStr::to_str) == Some(extension)
}
