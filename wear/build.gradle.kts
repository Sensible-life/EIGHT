plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.1.20"
}
android {
    namespace = "com.systemdesign.choreolayer"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.systemdesign.choreolayer"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // Data Layer requires the phone and watch to use exactly the same signing key.
    signingConfigs.getByName("debug") {
        storeFile = file("../app/android/app/debug.keystore")
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
}
dependencies {
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    testImplementation("junit:junit:4.13.2")
}
