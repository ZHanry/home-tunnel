import org.gradle.api.tasks.Sync

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val versionNameValue = providers.gradleProperty("HOME_TUNNEL_VERSION_NAME").get()
val versionCodeValue = providers.gradleProperty("HOME_TUNNEL_VERSION_CODE").get().toInt()
val packagedAbis = providers.environmentVariable("ANDROID_AGENT_ABIS").orNull
    ?.split(',')
    ?.map(String::trim)
    ?.filter(String::isNotEmpty)
    ?: listOf("arm64-v8a", "x86_64")
require(packagedAbis.isNotEmpty() && packagedAbis.all { it in setOf("arm64-v8a", "x86_64") }) {
    "ANDROID_AGENT_ABIS must contain only arm64-v8a and/or x86_64"
}

fun signingValue(environmentName: String, propertyName: String): String? =
    providers.environmentVariable(environmentName).orNull
        ?: providers.gradleProperty(propertyName).orNull

val releaseStoreFile = signingValue("ANDROID_RELEASE_STORE_FILE", "android.release.storeFile")
val releaseStorePassword = signingValue("ANDROID_RELEASE_STORE_PASSWORD", "android.release.storePassword")
val releaseKeyAlias = signingValue("ANDROID_RELEASE_KEY_ALIAS", "android.release.keyAlias")
val releaseKeyPassword = signingValue("ANDROID_RELEASE_KEY_PASSWORD", "android.release.keyPassword")
val completeReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "io.github.zhanry.hometunnel"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.zhanry.hometunnel"
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        resourceConfigurations += listOf("en", "zh-rCN")
        ndk.abiFilters += packagedAbis
    }

    if (completeReleaseSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(requireNotNull(releaseStoreFile))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (completeReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions.jvmTarget = "17"

    packaging {
        jniLibs {
            useLegacyPackaging = true
            keepDebugSymbols += "**/libhometunnel_agent.so"
        }
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "META-INF/DEPENDENCIES",
        )
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        // The GitHub Experimental APK is intentionally arm64-only; local/CI
        // builds can additionally request x86_64 for emulator coverage.
        disable += setOf("GradleDependency", "ChromeOsAbiSupport")
    }
}

val generatedThirdPartyAssets = layout.buildDirectory.dir("generated/homeTunnelAssets")
val syncThirdPartyNotices by tasks.registering(Sync::class) {
    from(rootProject.file("../windows-agent/FRP-LICENSE.txt"))
    from(rootProject.file("../windows-agent/THIRD-PARTY-NOTICES.txt"))
    into(generatedThirdPartyAssets)
}
android.sourceSets.getByName("main").assets.srcDir(generatedThirdPartyAssets)
tasks.named("preBuild").configure { dependsOn(syncThirdPartyNotices) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlin:kotlin-test:2.0.21")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
