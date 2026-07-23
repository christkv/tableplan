plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.spring")
    id("org.springframework.boot")
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:4.1.0"))
    implementation(project(":odm"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-security-oauth2-client")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("io.micrometer:micrometer-registry-prometheus")
    implementation("org.apache.commons:commons-csv:1.14.1")
    implementation("org.apache.pdfbox:pdfbox:3.0.8")
    implementation(platform("software.amazon.awssdk:bom:2.46.8"))
    implementation("software.amazon.awssdk:s3")
    implementation("org.springframework.boot:spring-boot-starter-mail")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("tools.jackson.dataformat:jackson-dataformat-yaml")
    implementation(kotlin("reflect"))

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

val frontendDirectory = layout.projectDirectory.dir("../frontend")
val frontendInstall by tasks.registering(Exec::class) {
    workingDir(frontendDirectory)
    commandLine("npm", "ci")
    inputs.files(frontendDirectory.file("package.json"), frontendDirectory.file("package-lock.json"))
    outputs.dir(frontendDirectory.dir("node_modules"))
}

val frontendBuild by tasks.registering(Exec::class) {
    dependsOn(frontendInstall)
    workingDir(frontendDirectory)
    commandLine("npm", "run", "build")
    inputs.dir(frontendDirectory.dir("src"))
    inputs.files(
        frontendDirectory.file("index.html"),
        frontendDirectory.file("package.json"),
        frontendDirectory.file("package-lock.json"),
        frontendDirectory.file("tsconfig.json"),
        frontendDirectory.file("vite.config.ts"),
    )
    outputs.dir(frontendDirectory.dir("dist"))
}

val frontendTest by tasks.registering(Exec::class) {
    dependsOn(frontendInstall)
    workingDir(frontendDirectory)
    commandLine("npm", "test")
    inputs.dir(frontendDirectory.dir("src"))
}

val copyFrontend by tasks.registering(org.gradle.api.tasks.Sync::class) {
    dependsOn(frontendBuild)
    from(frontendDirectory.dir("dist"))
    into(layout.buildDirectory.dir("generated-resources/static"))
}

sourceSets.main {
    resources.srcDir(layout.buildDirectory.dir("generated-resources"))
}

tasks.processResources {
    dependsOn(copyFrontend)
    from(layout.projectDirectory.file("../contracts/openapi.yaml")) {
        into("contracts")
    }
}

tasks.bootJar {
    archiveFileName.set("tableplan.jar")
}

tasks.check {
    dependsOn(frontendTest)
}
