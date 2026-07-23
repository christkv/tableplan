package com.tableplan.config

import com.mongodb.ConnectionString
import com.mongodb.MongoClientSettings
import com.mongodb.client.MongoClient
import com.mongodb.client.MongoClients
import com.mongodb.client.MongoDatabase
import org.bson.UuidRepresentation
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.util.concurrent.TimeUnit

@Configuration(proxyBeanMethods = false)
class MongoConfiguration {
    @Bean
    fun mongoClient(properties: TableplanProperties): MongoClient {
        val mongo = properties.mongo
        val settings =
            MongoClientSettings.builder()
                .applyConnectionString(ConnectionString(mongo.uri))
                .applicationName("tableplan")
                .uuidRepresentation(UuidRepresentation.STANDARD)
                .applyToConnectionPoolSettings {
                    it.maxSize(mongo.maxPoolSize)
                        .minSize(mongo.minPoolSize)
                        .maxWaitTime(mongo.waitQueueTimeoutMs, TimeUnit.MILLISECONDS)
                }
                .applyToClusterSettings {
                    it.serverSelectionTimeout(mongo.serverSelectionTimeoutMs, TimeUnit.MILLISECONDS)
                }
                .retryReads(true)
                .retryWrites(true)
                .build()
        return MongoClients.create(settings)
    }

    @Bean
    fun mongoDatabase(client: MongoClient, properties: TableplanProperties): MongoDatabase =
        client.getDatabase(properties.mongo.database)
}

