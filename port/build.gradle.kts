plugins {
    id("org.jetbrains.kotlin.jvm") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.spring") version "2.4.10" apply false
    id("org.springframework.boot") version "4.1.0" apply false
}

allprojects {
    group = "com.tableplan"
    version = "0.1.0-SNAPSHOT"
}

